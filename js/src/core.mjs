// command-stream - A unified shell command execution library
// Lightweight shell entry: shared by the full API and command-stream/core

import { trace } from './$.trace.mjs';
import {
  globalShellSettings,
  virtualCommands,
  enableVirtualCommands as enableVirtualCommandsState,
  disableVirtualCommands as disableVirtualCommandsState,
  forceCleanupAll,
  resetGlobalState,
} from './$.state.mjs';
import {
  buildShellCommand,
  isPreQuotedPassthroughEnabled,
  isQuoteContextEnabled,
  quote,
  quoteForContext,
  quoteLiteral,
  raw,
  setPreQuotedPassthroughEnabled,
  setQuoteContextEnabled,
} from './$.quote.mjs';
import {
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput,
} from './$.ansi.mjs';
import { ProcessRunner } from './process-runner.mjs';
import { command, CommandBuilder } from './command-builder.mjs';
import { fy } from './fy.mjs';
import { stream, merge, StreamPipeline } from './stream-processing.mjs';
import {
  createCommand,
  extend,
  inherit,
  compose,
  commandMetadata,
} from './command-registry.mjs';
import { toStreamResult } from './$.result-streams.mjs';
import crossSpawn from 'cross-spawn';

// Public APIs
async function sh(commandString, options = {}) {
  trace(
    'API',
    () =>
      `sh ENTER | ${JSON.stringify(
        {
          command: commandString,
          options,
        },
        null,
        2
      )}`
  );

  const runner = new ProcessRunner(
    { mode: 'shell', command: commandString },
    options
  );
  const result = await runner._startAsync();

  trace(
    'API',
    () => `sh EXIT | ${JSON.stringify({ code: result.code }, null, 2)}`
  );
  return toStreamResult(result);
}

async function exec(file, args = [], options = {}) {
  trace(
    'API',
    () =>
      `exec ENTER | ${JSON.stringify(
        {
          file,
          argsCount: args.length,
          options,
        },
        null,
        2
      )}`
  );

  const runner = new ProcessRunner({ mode: 'exec', file, args }, options);
  const result = await runner._startAsync();

  trace(
    'API',
    () => `exec EXIT | ${JSON.stringify({ code: result.code }, null, 2)}`
  );
  return toStreamResult(result);
}

// eslint-disable-next-line require-await -- delegates to sh/exec which are async
async function run(commandOrTokens, options = {}) {
  trace(
    'API',
    () =>
      `run ENTER | ${JSON.stringify(
        {
          type: typeof commandOrTokens,
          options,
        },
        null,
        2
      )}`
  );

  if (typeof commandOrTokens === 'string') {
    trace(
      'API',
      () =>
        `BRANCH: run => STRING_COMMAND | ${JSON.stringify({ command: commandOrTokens }, null, 2)}`
    );
    return sh(commandOrTokens, { ...options, mirror: false, capture: true });
  }

  const [file, ...args] = commandOrTokens;
  trace(
    'API',
    () =>
      `BRANCH: run => TOKEN_ARRAY | ${JSON.stringify({ file, argsCount: args.length }, null, 2)}`
  );
  return exec(file, args, { ...options, mirror: false, capture: true });
}

function detachedSpec(command) {
  if (typeof command === 'string') {
    return { mode: 'shell', command };
  }
  const [file, args = []] = Array.isArray(command)
    ? [command[0], command.slice(1)]
    : [command?.file, command?.args];
  if (typeof file !== 'string' || file === '') {
    throw new TypeError(
      'spawnDetached() needs a command string, an argv array or { file, args }'
    );
  }
  return { mode: 'exec', file, args: [...args] };
}

// Fire and forget (issue #232): resolves with `{ pid }` once the command has
// spawned, without waiting for it to exit.
// eslint-disable-next-line require-await -- async so a bad command rejects
async function spawnDetached(command, options = {}) {
  trace('API', () => `spawnDetached ENTER | ${JSON.stringify({ command })}`);
  return new ProcessRunner(detachedSpec(command), options).spawnDetached();
}

function $tagged(strings, ...values) {
  // Check if called as a function with options object: $({ options })
  if (
    !Array.isArray(strings) &&
    typeof strings === 'object' &&
    strings !== null
  ) {
    const options = strings;
    trace(
      'API',
      () =>
        `$tagged called with options | ${JSON.stringify({ options }, null, 2)}`
    );

    // Return a new tagged template function with those options
    const tagged = (innerStrings, ...innerValues) => {
      trace(
        'API',
        () =>
          `$tagged.withOptions ENTER | ${JSON.stringify(
            {
              stringsLength: innerStrings.length,
              valuesLength: innerValues.length,
              options,
            },
            null,
            2
          )}`
      );

      const cmd = buildShellCommand(innerStrings, innerValues);
      const runner = new ProcessRunner(
        { mode: 'shell', command: cmd },
        { mirror: true, capture: true, ...options }
      );

      trace(
        'API',
        () =>
          `$tagged.withOptions EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`
      );
      return runner;
    };
    tagged.command = command.with(options);
    return tagged;
  }

  // Normal tagged template literal usage
  trace(
    'API',
    () =>
      `$tagged ENTER | ${JSON.stringify(
        {
          stringsLength: strings.length,
          valuesLength: values.length,
        },
        null,
        2
      )}`
  );

  const cmd = buildShellCommand(strings, values);
  const runner = new ProcessRunner(
    { mode: 'shell', command: cmd },
    { mirror: true, capture: true }
  );

  trace(
    'API',
    () => `$tagged EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`
  );
  return runner;
}

function create(defaultOptions = {}, handler, metadata) {
  if (typeof defaultOptions === 'string' || arguments.length > 1) {
    return createCommand(defaultOptions, handler, metadata);
  }
  trace(
    'API',
    () => `create ENTER | ${JSON.stringify({ defaultOptions }, null, 2)}`
  );

  const tagged = (strings, ...values) => {
    trace(
      'API',
      () =>
        `create.tagged ENTER | ${JSON.stringify(
          {
            stringsLength: strings.length,
            valuesLength: values.length,
          },
          null,
          2
        )}`
    );

    const cmd = buildShellCommand(strings, values);
    const runner = new ProcessRunner(
      { mode: 'shell', command: cmd },
      { mirror: true, capture: true, ...defaultOptions }
    );

    trace(
      'API',
      () => `create.tagged EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`
    );
    return runner;
  };

  tagged.command = command.with(defaultOptions);
  trace('API', () => `create EXIT | ${JSON.stringify({}, null, 2)}`);
  return tagged;
}

/**
 * Mark a value as literal text that should use double-quote escaping.
 *
 * Use this when passing text to programs that store it literally (like API calls
 * via CLI tools) rather than interpreting it as shell commands. This preserves
 * apostrophes as-is instead of using the '\'' escape pattern.
 *
 * Unlike raw(), literal() still provides proper shell escaping for special
 * characters like $, `, \, and ", but apostrophes pass through unchanged.
 *
 * @example
 * // Problem: apostrophe gets escaped as '\''
 * await $`gh release create --notes ${text}`;  // "didn't" → "didn'\''t" → appears as "didn'''t"
 *
 * // Solution: use literal() to preserve apostrophes
 * await $`gh release create --notes ${literal(text)}`;  // "didn't" stays "didn't"
 *
 * @param {*} value - The value to mark as literal
 * @returns {{ literal: string }} - Object with literal property for buildShellCommand
 */
function literal(value) {
  trace(
    'API',
    () => `literal() called with value: ${String(value).slice(0, 50)}`
  );
  return { literal: String(value) };
}

function set(option) {
  trace('API', () => `set() called with option: ${option}`);
  const mapping = {
    e: 'errexit', // set -e: exit on error
    errexit: 'errexit',
    v: 'verbose', // set -v: verbose
    verbose: 'verbose',
    x: 'xtrace', // set -x: trace execution
    xtrace: 'xtrace',
    u: 'nounset', // set -u: error on unset vars
    nounset: 'nounset',
    'o pipefail': 'pipefail', // set -o pipefail
    pipefail: 'pipefail',
  };

  if (mapping[option]) {
    globalShellSettings[mapping[option]] = true;
    if (globalShellSettings.verbose) {
      console.log(`+ set -${option}`);
    }
  }
  return globalShellSettings;
}

function unset(option) {
  trace('API', () => `unset() called with option: ${option}`);
  const mapping = {
    e: 'errexit',
    errexit: 'errexit',
    v: 'verbose',
    verbose: 'verbose',
    x: 'xtrace',
    xtrace: 'xtrace',
    u: 'nounset',
    nounset: 'nounset',
    'o pipefail': 'pipefail',
    pipefail: 'pipefail',
  };

  if (mapping[option]) {
    globalShellSettings[mapping[option]] = false;
    if (globalShellSettings.verbose) {
      console.log(`+ set +${option}`);
    }
  }
  return globalShellSettings;
}

// Convenience functions for common patterns
const shell = {
  set,
  unset,
  settings: () => ({ ...globalShellSettings }),

  // Bash-like shortcuts
  errexit: (enable = true) => (enable ? set('e') : unset('e')),
  verbose: (enable = true) => (enable ? set('v') : unset('v')),
  xtrace: (enable = true) => (enable ? set('x') : unset('x')),
  pipefail: (enable = true) =>
    enable ? set('o pipefail') : unset('o pipefail'),
  nounset: (enable = true) => (enable ? set('u') : unset('u')),

  // Quote-context aware interpolation (on by default). Pass false to restore
  // the historical behaviour of always single-quoting interpolated values,
  // or null to follow COMMAND_STREAM_QUOTE_CONTEXT again.
  quoteContext: (enable = true) => setQuoteContextEnabled(enable),

  // Legacy pre-quoted passthrough (off by default): when enabled, a value that
  // is already wrapped in matching quotes is spliced in as shell syntax instead
  // of being treated as literal text. Pass null to follow
  // COMMAND_STREAM_PREQUOTED_PASSTHROUGH again.
  preQuotedPassthrough: (enable = true) =>
    setPreQuotedPassthroughEnabled(enable),
};

// Virtual command registration API
function register(name, handler) {
  trace(
    'VirtualCommands',
    () => `register ENTER | ${JSON.stringify({ name }, null, 2)}`
  );
  virtualCommands.set(name, handler);
  commandMetadata.delete(name);
  trace(
    'VirtualCommands',
    () => `register EXIT | ${JSON.stringify({ registered: true }, null, 2)}`
  );
  return virtualCommands;
}

function unregister(name) {
  trace(
    'VirtualCommands',
    () => `unregister ENTER | ${JSON.stringify({ name }, null, 2)}`
  );
  const deleted = virtualCommands.delete(name);
  commandMetadata.delete(name);
  trace(
    'VirtualCommands',
    () => `unregister EXIT | ${JSON.stringify({ deleted }, null, 2)}`
  );
  return deleted;
}

function listCommands() {
  const commands = Array.from(virtualCommands.keys());
  trace(
    'VirtualCommands',
    () => `listCommands() returning ${commands.length} commands`
  );
  return commands;
}

// Use the imported functions from $.state.mjs
const enableVirtualCommands = enableVirtualCommandsState;
const disableVirtualCommands = disableVirtualCommandsState;

// Import virtual commands
import cdCommand from './commands/$.cd.mjs';
import pwdCommand from './commands/$.pwd.mjs';
import echoCommand from './commands/$.echo.mjs';
import sleepCommand from './commands/$.sleep.mjs';
import trueCommand from './commands/$.true.mjs';
import falseCommand from './commands/$.false.mjs';
import createWhichCommand from './commands/$.which.mjs';
import createExitCommand from './commands/$.exit.mjs';
import envCommand from './commands/$.env.mjs';
import catCommand from './commands/$.cat.mjs';
import lsCommand from './commands/$.ls.mjs';
import mkdirCommand from './commands/$.mkdir.mjs';
import rmCommand from './commands/$.rm.mjs';
import mvCommand from './commands/$.mv.mjs';
import cpCommand from './commands/$.cp.mjs';
import touchCommand from './commands/$.touch.mjs';
import basenameCommand from './commands/$.basename.mjs';
import dirnameCommand from './commands/$.dirname.mjs';
import yesCommand from './commands/$.yes.mjs';
import seqCommand from './commands/$.seq.mjs';
import teeCommand from './commands/$.tee.mjs';
import testCommand from './commands/$.test.mjs';
import fyCommand from './commands/$.$fy.mjs';
import headCommand from './commands/$.head.mjs';
import tailCommand from './commands/$.tail.mjs';
import sortCommand from './commands/$.sort.mjs';
import uniqCommand from './commands/$.uniq.mjs';

// Built-in commands that match Bun.$ functionality
function registerBuiltins() {
  trace(
    'VirtualCommands',
    () => 'registerBuiltins() called - registering all built-in commands'
  );
  // Register all imported commands
  register('cd', cdCommand);
  register('pwd', pwdCommand);
  register('echo', echoCommand);
  register('sleep', sleepCommand);
  register('true', trueCommand);
  register('false', falseCommand);
  register('which', createWhichCommand(virtualCommands));
  register('exit', createExitCommand());
  register('env', envCommand);
  register('cat', catCommand);
  register('ls', lsCommand);
  register('mkdir', mkdirCommand);
  register('rm', rmCommand);
  register('mv', mvCommand);
  register('cp', cpCommand);
  register('touch', touchCommand);
  register('basename', basenameCommand);
  register('dirname', dirnameCommand);
  register('yes', yesCommand);
  register('seq', seqCommand);
  register('tee', teeCommand);
  register('test', testCommand);
  register('$fy', fyCommand);
  register('head', headCommand);
  register('tail', tailCommand);
  register('sort', sortCommand);
  register('uniq', uniqCommand);
}

// Initialize built-in commands

$tagged.spawn = crossSpawn;
$tagged.command = command;
$tagged.fy = fy;
$tagged.stream = stream;
$tagged.merge = merge;
Object.assign($tagged, {
  create,
  register,
  unregister,
  listCommands,
  extend,
  inherit,
  compose,
});
trace('Initialization', () => 'Registering built-in virtual commands');
registerBuiltins();
trace(
  'Initialization',
  () => `Built-in commands registered: ${listCommands().join(', ')}`
);

export {
  extend,
  inherit,
  compose,
  stream,
  merge,
  StreamPipeline,
  command,
  CommandBuilder,
  fy,
  $tagged as $,
  sh,
  exec,
  spawnDetached,
  crossSpawn as spawn,
  run,
  quote,
  quoteForContext,
  quoteLiteral,
  isQuoteContextEnabled,
  setQuoteContextEnabled,
  isPreQuotedPassthroughEnabled,
  setPreQuotedPassthroughEnabled,
  create,
  raw,
  literal,
  ProcessRunner,
  shell,
  set,
  resetGlobalState,
  unset,
  register,
  unregister,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput,
  forceCleanupAll,
};
export default $tagged;
