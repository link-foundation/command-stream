// The feature catalog: one entry per feature of command-stream.
//
// Each entry names the example that demonstrates the feature and shows how the
// same thing is written with the other shell libraries, so the generated
// documentation is a side-by-side comparison rather than a list of links.
//
// An alternative is either a code snippet or `{ unsupported: 'reason' }`. The
// reasons are deliberately specific: "no equivalent" is not useful to a reader
// deciding between libraries.
//
// Representative alternatives were executed against the listed versions;
// see experiments/alt-libs-probe.mjs and experiments/bun-shell-probe.mjs.

export const libraries = [
  {
    id: 'command-stream',
    name: 'command-stream',
    url: 'https://github.com/link-foundation/command-stream',
    runtimes: ['Node.js', 'Bun'],
  },
  {
    id: 'bun-shell',
    name: 'Bun.$',
    version: '1.4',
    url: 'https://bun.com/docs/runtime/shell',
    runtimes: ['Bun'],
  },
  {
    id: 'zx',
    name: 'zx',
    version: '8',
    url: 'https://github.com/google/zx',
    runtimes: ['Node.js', 'Bun', 'Deno'],
  },
  {
    id: 'execa',
    name: 'execa',
    version: '9.6',
    url: 'https://github.com/sindresorhus/execa',
    runtimes: ['Node.js', 'Bun', 'Deno'],
  },
  {
    id: 'shelljs',
    name: 'ShellJS',
    version: '0.10',
    url: 'https://github.com/shelljs/shelljs',
    runtimes: ['Node.js', 'Bun'],
  },
  {
    id: 'child_process',
    name: 'node:child_process',
    url: 'https://nodejs.org/api/child_process.html',
    runtimes: ['Node.js', 'Bun', 'Deno'],
  },
];

export const categories = [
  'Running commands',
  'Reading output',
  'Streaming',
  'Built-in commands',
  'Your own commands',
  'Shell syntax',
  'Utilities',
];

export const features = [
  {
    id: 'await-result',
    title: 'Await a command',
    category: 'Running commands',
    summary:
      'Awaiting a command returns an object with stdout, stderr and the exit code.',
    file: 'js/examples/features/await-result.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell':
        'const { stdout, stderr, exitCode } = await $`echo hi`.quiet();\n// stdout and stderr are Buffers, not strings',
      zx: 'const { stdout, stderr, exitCode } = await $`echo hi`;',
      execa:
        'const { stdout, stderr, exitCode } = await execa`echo hi`;\n// no shell is involved, so `echo hi` is the binary `echo` with one argument',
      shelljs:
        "const result = shell.exec('echo hi', { silent: true });\n// result.stdout, result.stderr, result.code",
      child_process:
        "const { stdout, stderr } = await promisify(execFile)('echo', ['hi']);",
    },
  },
  {
    id: 'result-text',
    title: 'Read the output with text()',
    category: 'Reading output',
    summary:
      'Captured stdout is available as text through each language’s result API.',
    file: 'js/examples/features/result-text.mjs',
    api: ['$', 'ProcessRunner#text'],
    alternatives: {
      'bun-shell': 'const text = await $`echo hi`.text();',
      zx: 'const text = (await $`echo hi`).toString();',
      execa: 'const text = (await execa`echo hi`).stdout;',
      shelljs: "const text = shell.exec('echo hi', { silent: true }).stdout;",
      child_process:
        "const text = (await promisify(execFile)('echo', ['hi'])).stdout;",
    },
  },
  {
    id: 'sync-execution',
    title: 'Synchronous execution',
    category: 'Running commands',
    summary:
      'The same command can be run without awaiting, blocking until it finishes.',
    file: 'js/examples/features/sync-execution.mjs',
    api: ['$', 'ProcessRunner#sync'],
    alternatives: {
      'bun-shell': {
        unsupported:
          'Bun.$ is always asynchronous; Bun.spawnSync is the synchronous escape hatch, and it takes an argument array rather than a command line',
      },
      zx: 'const { stdout } = $.sync`echo hi`;',
      execa: 'const { stdout } = execaSync`echo hi`;',
      shelljs:
        "const stdout = shell.exec('echo hi', { silent: true }).stdout; // synchronous by default",
      child_process:
        "const stdout = execFileSync('echo', ['hi'], { encoding: 'utf8' });",
    },
  },
  {
    id: 'exit-codes',
    title: 'Exit codes and errors',
    category: 'Running commands',
    summary:
      'A non-zero exit code is reported on the result instead of thrown, unless errexit is set.',
    file: 'js/examples/features/exit-codes.mjs',
    api: ['$', 'shell.errexit'],
    alternatives: {
      'bun-shell':
        'const { exitCode } = await $`exit 3`.nothrow(); // throws without .nothrow()',
      zx: 'const { exitCode } = await $({ nothrow: true })`exit 3`; // throws without nothrow',
      execa:
        "const { exitCode } = await execa({ reject: false })`sh -c 'exit 3'`; // throws without reject: false",
      shelljs:
        "const code = shell.exec('exit 3', { silent: true }).code; // never throws",
      child_process:
        '// execFile rejects on a non-zero exit; the code is on error.code',
    },
  },
  {
    id: 'options',
    title: 'Options: capture, cwd, env, stdin',
    category: 'Running commands',
    summary:
      'Execution options control capture, cwd, environment and stdin for a command or reusable runner.',
    file: 'js/examples/features/options.mjs',
    api: ['$', 'create'],
    alternatives: {
      'bun-shell': "await $`pwd`.cwd('/tmp').env({ KEY: 'value' }).quiet();",
      zx: "const $$ = $({ cwd: '/tmp', env: { KEY: 'value' } });",
      execa: "const run = execa({ cwd: '/tmp', env: { KEY: 'value' } });",
      shelljs:
        "shell.cd('/tmp'); shell.env.KEY = 'value'; // process-wide, not per command",
      child_process:
        "execFile('pwd', [], { cwd: '/tmp', env: { KEY: 'value' } });",
    },
  },
  {
    id: 'function-api',
    title: 'Function and builder APIs',
    category: 'Running commands',
    summary:
      'Commands can also be built from plain strings instead of template literals.',
    file: 'js/examples/features/function-api.mjs',
    api: ['sh', 'exec', 'run', 'create', 'shell'],
    alternatives: {
      'bun-shell': {
        unsupported:
          'Bun.$ only accepts a tagged template; a string has to be turned back into one by hand',
      },
      zx: "await $({ input: '' })`sh -c ${'echo hi'}`; // or build a template array manually",
      execa: "await execa('echo', ['hi']); // the classic function form",
      shelljs: "shell.exec('echo hi'); // strings are the only form",
      child_process: "execFile('echo', ['hi']);",
    },
  },
  {
    id: 'cancellation',
    title: 'Killing and cancelling commands',
    category: 'Running commands',
    summary:
      'A running command can be killed, and cancelling one leaves the rest of the script running.',
    file: 'js/examples/features/cancellation.mjs',
    api: ['$', 'ProcessRunner#child', 'ProcessRunner#kill', 'forceCleanupAll'],
    alternatives: {
      'bun-shell': {
        unsupported:
          'a ShellPromise has no kill method; the command runs to completion',
      },
      zx: 'const p = $({ nothrow: true })`sleep 5`; p.kill();',
      execa: 'const p = execa({ reject: false })`sleep 5`; p.kill();',
      shelljs:
        "const child = shell.exec('sleep 5', { async: true }); child.kill();",
      child_process: "const child = spawn('sleep', ['5']); child.kill();",
    },
  },
  {
    id: 'async-iteration',
    title: 'Async iteration over output',
    category: 'Streaming',
    summary:
      'A command is an async iterable of chunks, so output can be handled as it arrives.',
    file: 'js/examples/features/async-iteration.mjs',
    api: ['$', 'ProcessRunner#[Symbol.asyncIterator]', 'ProcessRunner#stream'],
    alternatives: {
      'bun-shell':
        "for await (const line of $`printf 'a\\nb\\n'`.lines()) { /* line by line only */ }",
      zx: "for await (const line of $`printf 'a\\nb\\n'`) { /* lines */ }",
      execa:
        "for await (const line of execa`printf 'a\\nb\\n'`) { /* lines */ }",
      shelljs: {
        unsupported:
          'output is only delivered as a whole string, or through the raw child process in async mode',
      },
      child_process:
        "for await (const chunk of spawn('printf', ['a\\nb\\n']).stdout) { /* Buffers */ }",
    },
  },
  {
    id: 'events',
    title: 'Event-driven output',
    category: 'Streaming',
    summary:
      'Event APIs report output and lifecycle signals as work progresses.',
    file: 'js/examples/features/events.mjs',
    api: ['$', 'ProcessRunner#on', 'ProcessRunner#off'],
    alternatives: {
      'bun-shell': {
        unsupported:
          'a ShellPromise is not an EventEmitter and exposes no streams',
      },
      zx: "$`echo hi`.stdout.on('data', chunk => { /* Node stream events */ });",
      execa:
        "execa`echo hi`.stdout.on('data', chunk => { /* Node stream events */ });",
      shelljs:
        "shell.exec('echo hi', { async: true }).stdout.on('data', chunk => {});",
      child_process: "spawn('echo', ['hi']).stdout.on('data', chunk => {});",
    },
  },
  {
    id: 'stdin-streaming',
    title: 'Writing to stdin while a command runs',
    category: 'Streaming',
    summary: 'Input can be supplied up front or written to a running command.',
    file: 'js/examples/features/stdin-streaming.mjs',
    api: ['$', 'ProcessRunner#stdin'],
    alternatives: {
      'bun-shell':
        "await $`cat < ${new Response('x')}`.quiet(); // a value, not a live stream",
      zx: "const p = $`cat`; p.stdin.write('x'); p.stdin.end();",
      execa: "const p = execa`cat`; p.stdin.write('x'); p.stdin.end();",
      shelljs: "shell.ShellString('x').exec('cat'); // value only",
      child_process:
        "const p = spawn('cat'); p.stdin.write('x'); p.stdin.end();",
    },
  },
  {
    id: 'buffers-strings',
    title: 'Buffer and string interfaces',
    category: 'Reading output',
    summary:
      'Output is available as a string and as raw bytes, without running the command twice.',
    file: 'js/examples/features/buffers-strings.mjs',
    api: ['$', 'ProcessRunner#text', 'ProcessRunner#buffers'],
    alternatives: {
      'bun-shell':
        'const result = await $`echo hi`.quiet(); result.stdout; // Buffer\nawait $`echo hi`.text();      // string, but runs the command again',
      zx: 'const p = await $`echo hi`; p.stdout; // string\nBuffer.from(p.stdout);               // bytes by conversion',
      execa:
        "const { stdout } = await execa({ encoding: 'buffer' })`echo hi`; // choose one up front",
      shelljs: {
        unsupported:
          'output is decoded to a string; raw bytes are not available',
      },
      child_process:
        "const { stdout } = await promisify(execFile)('echo', ['hi'], { encoding: 'buffer' });",
    },
  },
  {
    id: 'mirror-capture',
    title: 'Mirroring and capturing output',
    category: 'Reading output',
    summary:
      'Output can be shown, captured, both or neither, chosen independently.',
    file: 'js/examples/features/mirror-capture.mjs',
    api: ['$', 'create'],
    alternatives: {
      'bun-shell':
        'await $`echo hi`;          // shown and captured\nawait $`echo hi`.quiet();   // captured only',
      zx: '$.verbose = true;           // shown and captured\nawait $({ quiet: true })`echo hi`;',
      execa:
        "await execa({ stdout: ['pipe', 'inherit'] })`echo hi`; // both, by listing destinations",
      shelljs:
        "shell.exec('echo hi');                  // shown and captured\nshell.exec('echo hi', { silent: true }); // captured only",
      child_process:
        "spawn('echo', ['hi'], { stdio: 'inherit' }); // shown, but then not captured",
    },
  },
  {
    id: 'builtin-catalog',
    title: 'The built-in command catalog',
    category: 'Built-in commands',
    summary:
      'Common commands are implemented in-process in both languages for portable behavior.',
    file: 'js/examples/features/builtin-catalog.mjs',
    api: ['listCommands', 'enableVirtualCommands', 'disableVirtualCommands'],
    alternatives: {
      'bun-shell':
        '// a fixed set of built-ins (cd, echo, ls, rm, ...) that cannot be listed or turned off',
      zx: {
        unsupported:
          'every command is handed to the system shell; the fs and glob helpers are separate APIs, not commands',
      },
      execa: { unsupported: 'every command is a real binary' },
      shelljs:
        'shell.ls(); shell.cat(); shell.mkdir(); // built-ins, but as functions rather than commands',
      child_process: { unsupported: 'every command is a real binary' },
    },
  },
  {
    id: 'builtin-filesystem',
    title: 'File system built-ins',
    category: 'Built-in commands',
    summary: 'ls, cat, mkdir, touch, cp, mv, rm and test run in-process.',
    file: 'js/examples/features/builtin-filesystem.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell':
        'await $`mkdir -p dir`; await $`ls dir`.text(); // built-in, same idea',
      zx: "await fs.mkdirp('dir'); // zx re-exports fs-extra instead of implementing commands",
      execa: { unsupported: 'use node:fs' },
      shelljs: "shell.mkdir('-p', 'dir'); shell.ls('dir');",
      child_process: { unsupported: 'use node:fs' },
    },
  },
  {
    id: 'builtin-text',
    title: 'Text and value built-ins',
    category: 'Built-in commands',
    summary:
      'echo, seq, yes, basename, dirname, true and false run in-process.',
    file: 'js/examples/features/builtin-text.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell':
        'await $`echo hi`.text(); // echo is a built-in; seq and yes are not',
      zx: 'await $`echo hi`; // the system binaries',
      execa: "await execa('echo', ['hi']); // the system binaries",
      shelljs: "shell.echo('hi'); // echo only",
      child_process: "execFile('echo', ['hi']); // the system binaries",
    },
  },
  {
    id: 'builtin-environment',
    title: 'Environment built-ins',
    category: 'Built-in commands',
    summary:
      'cd, pwd, env, which and exit affect the command they run in, not the host process.',
    file: 'js/examples/features/builtin-environment.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell':
        'await $`cd /tmp && pwd`.text(); // cd is scoped to the command',
      zx: "cd('/tmp'); // changes the directory for every later command",
      execa: "execa({ cwd: '/tmp' })`pwd`; // an option, not a command",
      shelljs:
        "shell.cd('/tmp'); shell.pwd(); // changes the process working directory",
      child_process: "execFile('pwd', [], { cwd: '/tmp' });",
    },
  },
  {
    id: 'virtual-commands',
    title: 'Registering your own commands',
    category: 'Your own commands',
    summary:
      'A handler can be registered by name and invoked through a registry or command runner.',
    file: 'js/examples/features/virtual-commands.mjs',
    api: ['register', 'unregister', 'listCommands'],
    alternatives: {
      'bun-shell': {
        unsupported:
          'the built-in set is fixed; a name cannot be bound to a JavaScript function',
      },
      zx: { unsupported: 'a command name always resolves to a binary in PATH' },
      execa: {
        unsupported: 'a command name always resolves to a binary in PATH',
      },
      shelljs:
        "require('shelljs/plugin').register('greet', (options, name) => `hi ${name}\\n`);\nshell.greet('bob'); // a method, not a command usable inside a pipeline string",
      child_process: {
        unsupported: 'a command name always resolves to a binary in PATH',
      },
    },
  },
  {
    id: 'virtual-context',
    title: 'The handler context',
    category: 'Your own commands',
    summary:
      'A handler receives args, stdin, cwd, env and a cancellation signal.',
    file: 'js/examples/features/virtual-context.mjs',
    api: ['register'],
    alternatives: {
      'bun-shell': { unsupported: 'no handler API' },
      zx: { unsupported: 'no handler API' },
      execa: { unsupported: 'no handler API' },
      shelljs:
        "require('shelljs/plugin').readFromPipe(); // stdin only; no cwd, env or cancellation",
      child_process: { unsupported: 'no handler API' },
    },
  },
  {
    id: 'virtual-streaming',
    title: 'Streaming commands',
    category: 'Your own commands',
    summary:
      'A streaming handler publishes output incrementally like a real process.',
    file: 'js/examples/features/virtual-streaming.mjs',
    api: ['register'],
    alternatives: {
      'bun-shell': { unsupported: 'no handler API' },
      zx: { unsupported: 'no handler API' },
      execa: { unsupported: 'no handler API' },
      shelljs: {
        unsupported: 'a plugin returns its output as one value when it is done',
      },
      child_process: { unsupported: 'no handler API' },
    },
  },
  {
    id: 'pipelines',
    title: 'Pipelines',
    category: 'Shell syntax',
    summary:
      'Commands can be composed into pipelines whose output feeds the next stage.',
    file: 'js/examples/features/pipelines.mjs',
    api: ['$', 'ProcessRunner#pipe'],
    alternatives: {
      'bun-shell': 'await $`echo hi | tr a-z A-Z`.text();',
      zx: 'await $`echo hi`.pipe($`tr a-z A-Z`);',
      execa: 'await execa`echo hi`.pipe`tr a-z A-Z`;',
      shelljs: "shell.echo('hi').exec('tr a-z A-Z');",
      child_process: '// connect the streams by hand: a.stdout.pipe(b.stdin)',
    },
  },
  {
    id: 'redirection',
    title: 'Redirecting output and input',
    category: 'Shell syntax',
    summary:
      '>, >> and < redirect command input and output with shell-compatible behavior.',
    file: 'js/examples/features/redirection.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell': 'await $`echo hi > out.txt`;',
      zx: 'await $`echo hi > out.txt`; // handled by the system shell',
      execa: "await execa({ stdout: { file: 'out.txt' } })`echo hi`;",
      shelljs: "shell.echo('hi').to('out.txt');",
      child_process:
        "spawn('echo', ['hi'], { stdio: ['ignore', fs.openSync('out.txt', 'w'), 'inherit'] });",
    },
  },
  {
    id: 'sequences',
    title: 'Command sequences',
    category: 'Shell syntax',
    summary:
      '&&, ||, ; and parentheses execute with the expected shell semantics.',
    file: 'js/examples/features/sequences.mjs',
    api: ['$'],
    alternatives: {
      'bun-shell': 'await $`mkdir -p dir && cd dir && pwd`.text();',
      zx: 'await $`mkdir -p dir && cd dir && pwd`; // the system shell runs it',
      execa: {
        unsupported:
          'no shell operators unless the shell option is turned on, which gives up escaping',
      },
      shelljs:
        "shell.exec('mkdir -p dir && cd dir && pwd'); // the system shell runs it",
      child_process: "execFile('sh', ['-c', 'mkdir -p dir && cd dir && pwd']);",
    },
  },
  {
    id: 'interpolation',
    title: 'Safe interpolation',
    category: 'Shell syntax',
    summary:
      'Interpolated values are escaped as arguments; each language also exposes an explicit raw form.',
    file: 'js/examples/features/interpolation.mjs',
    api: ['$', 'quote', 'raw'],
    alternatives: {
      'bun-shell':
        'await $`echo ${value}`; // escaped; $.escape(value) shows the result',
      zx: 'await $`echo ${value}`; // escaped; quote(value) shows the result',
      execa:
        'await execa`echo ${value}`; // passed as an argument, no shell to escape for',
      shelljs: {
        unsupported:
          'shell.exec takes a string, so escaping is the caller’s job',
      },
      child_process:
        "execFile('echo', [value]); // arguments are never parsed as shell syntax",
    },
  },
  {
    id: 'shell-settings',
    title: 'Shell settings',
    category: 'Shell syntax',
    summary:
      'Shell settings model errexit, pipefail, verbose, xtrace and nounset behavior.',
    file: 'js/examples/features/shell-settings.mjs',
    api: ['shell', 'set', 'unset'],
    alternatives: {
      'bun-shell': '$.throws(true); // errexit only',
      zx: '$.verbose = true; // verbose only; the rest belong to the system shell',
      execa: {
        unsupported:
          'no shell settings; the equivalents are per-command options',
      },
      shelljs:
        'shell.config.fatal = true; shell.config.verbose = true; // errexit and verbose',
      child_process: "execFile('sh', ['-c', 'set -eo pipefail; ...']);",
    },
  },
  {
    id: 'ansi-utils',
    title: 'ANSI and control character helpers',
    category: 'Utilities',
    summary:
      'Helpers can strip colours and control characters from captured output.',
    file: 'js/examples/features/ansi-utils.mjs',
    api: ['AnsiUtils', 'configureAnsi', 'getAnsiConfig', 'processOutput'],
    alternatives: {
      'bun-shell': { unsupported: 'no helper; strip the codes yourself' },
      zx: 'chalk is re-exported for adding colour, but there is no helper for removing it',
      execa:
        'await execa({ stripFinalNewline: true })`echo hi`; // trailing newline only, not ANSI',
      shelljs: { unsupported: 'no helper; strip the codes yourself' },
      child_process: { unsupported: 'no helper; strip the codes yourself' },
    },
  },
];

export const featuresById = new Map(
  features.map((feature) => [feature.id, feature])
);

export const languages = [
  {
    id: 'javascript',
    name: 'JavaScript',
    source: 'js/examples/features/',
  },
  {
    id: 'rust',
    name: 'Rust',
    source: 'rust/examples/language_features.rs',
  },
];

export const rustApiByFeature = new Map(
  Object.entries({
    'await-result': ['run', 'CommandResult'],
    'result-text': ['CommandResult::stdout'],
    'sync-execution': ['run_sync'],
    'exit-codes': ['CommandResult::code', 'CommandResult::error_for_status'],
    options: ['exec', 'RunOptions'],
    'function-api': ['run', 'exec', 'create'],
    cancellation: [
      'ProcessRunner::child',
      'ProcessChild::kill',
      'OutputStream::kill',
    ],
    'async-iteration': ['StreamingRunner', 'OutputStream::next'],
    events: ['StreamEmitter', 'EventType', 'EventData'],
    'stdin-streaming': [
      'ProcessRunner::write_stdin',
      'ProcessRunner::close_stdin',
    ],
    'buffers-strings': ['CommandResult::stdout', 'OutputChunk'],
    'mirror-capture': ['RunOptions::mirror', 'RunOptions::capture'],
    'builtin-catalog': ['VirtualCommandRegistry::with_builtins'],
    'builtin-filesystem': ['mkdir', 'touch', 'ls', 'rm'],
    'builtin-text': ['echo', 'seq', 'basename', 'dirname', 'test', 'which'],
    'builtin-environment': ['pwd', 'cd', 'env'],
    'virtual-commands': [
      'VirtualCommandRegistry::register',
      'VirtualCommandRegistry::unregister',
    ],
    'virtual-context': ['CommandContext'],
    'virtual-streaming': ['CommandContext::output_tx', 'StreamChunk'],
    pipelines: ['Pipeline', 'PipelineExt'],
    redirection: ['exec'],
    sequences: ['exec'],
    interpolation: ['cmd!', 'quote'],
    'shell-settings': [
      'ShellSettings',
      'set_shell_option',
      'unset_shell_option',
    ],
    'ansi-utils': ['AnsiUtils', 'AnsiConfig'],
  })
);
