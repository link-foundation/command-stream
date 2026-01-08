// command-stream - A unified shell command execution library
// Main entry point - integrates all ProcessRunner modules

import { trace } from './$.trace.mjs';
import {
  globalShellSettings,
  virtualCommands,
  isVirtualCommandsEnabled,
  enableVirtualCommands as enableVirtualCommandsState,
  disableVirtualCommands as disableVirtualCommandsState,
  forceCleanupAll,
  resetGlobalState,
} from './$.state.mjs';
import { buildShellCommand, quote, raw } from './$.quote.mjs';
import {
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput,
} from './$.ansi.mjs';

// Import ProcessRunner base and method modules
import { ProcessRunner } from './$.process-runner-base.mjs';
import { attachExecutionMethods } from './$.process-runner-execution.mjs';
import { attachPipelineMethods } from './$.process-runner-pipeline.mjs';
import { attachVirtualCommandMethods } from './$.process-runner-virtual.mjs';
import { attachStreamKillMethods } from './$.process-runner-stream-kill.mjs';

// Create dependencies object for method attachment
const deps = {
  virtualCommands,
  globalShellSettings,
  isVirtualCommandsEnabled,
};

// Attach all methods to ProcessRunner prototype using mixin pattern
attachExecutionMethods(ProcessRunner, deps);
attachPipelineMethods(ProcessRunner, deps);
attachVirtualCommandMethods(ProcessRunner, deps);
attachStreamKillMethods(ProcessRunner, deps);

trace(
  'Initialization',
  () => 'ProcessRunner methods attached via mixin pattern'
);

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
  return result;
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
  return result;
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
    return (innerStrings, ...innerValues) => {
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

function create(defaultOptions = {}) {
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

  trace('API', () => `create EXIT | ${JSON.stringify({}, null, 2)}`);
  return tagged;
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
};

// Virtual command registration API
function register(name, handler) {
  trace(
    'VirtualCommands',
    () => `register ENTER | ${JSON.stringify({ name }, null, 2)}`
  );
  virtualCommands.set(name, handler);
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
import testCommand from './commands/$.test.mjs';

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
  register('exit', createExitCommand(globalShellSettings));
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
  register('test', testCommand);
}

// Initialize built-in commands
trace('Initialization', () => 'Registering built-in virtual commands');
registerBuiltins();
trace(
  'Initialization',
  () => `Built-in commands registered: ${listCommands().join(', ')}`
);

export {
  $tagged as $,
  sh,
  exec,
  run,
  quote,
  create,
  raw,
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
