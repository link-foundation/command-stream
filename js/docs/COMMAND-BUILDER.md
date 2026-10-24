# Command builder API

`$.command`, the named `command` factory, and `CommandBuilder` construct lazy,
immutable descriptions. Execution passes the executable and arguments directly
to ProcessRunner in `exec` mode. No shell parses them. This API is available from
`command-stream`, `command-stream/core`, and `command-stream/process-runner`;
ESM and CommonJS share the same implementation.

## Build and execute

```js
import { $, command, CommandBuilder } from 'command-stream';

// The API from issue #34: inherit output and resolve to the integer exit code.
const code = await $.command('cat', './some-file.txt')
  .pipe($.command.stdout('inherit'), $.command.exitCode)
  .run();

const base = command('node', '-e', 'console.log(process.argv[1])');
const configured = base.arg('hello ; $HOME').stdout('pipe').mirror(false);
const result = await configured.run();
console.log(await result.text()); // hello ; $HOME\n

// Equivalent construction styles.
const argv = command('node', ['-e', 'console.log(42)'], { capture: true });
const explicit = new CommandBuilder('node', ['-e', 'console.log(42)']);
const status = explicit.exitCode().sync();
```

Every configuration method returns a new builder. Keep the return value when
adding arguments or options. `base` above remains unchanged. Each `await builder`,
`.run()` or `.sync()` starts a fresh execution, so running a description twice
executes it twice. `.run()` returns a promise of the result; `.runner()` exposes
the ProcessRunner when events, live stdin, killing or process pipelines are needed.

| Construction or operation                                                   | Behavior                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `command(file, ...args)`                                                    | Variadic literal arguments                                   |
| `command(file, args, options?)`                                             | An argv array plus optional ProcessOptions                   |
| `new CommandBuilder(file, args?, options?)`                                 | Explicit construction                                        |
| `.arg(...args)` / `command.arg(...args)`                                    | Append arguments, preserving empty strings                   |
| `.with(options)` / `command.options(options)`                               | Configure any ProcessOptions                                 |
| `.stdin(input)` / `command.stdin(input)`                                    | String, Buffer, `pipe`, `inherit`, or `ignore`               |
| `.stdout(mode)`, `.stderr(mode)` / matching transforms                      | `pipe`, `inherit`, or `ignore`                               |
| `.cwd(path)`, `.env(vars)` / matching transforms                            | Set directory; merge successive explicit environment layers  |
| `.capture(enabled = true)`, `.mirror(enabled = true)` / matching transforms | Collect output; independently mirror piped output live       |
| `.pipe(...transforms)`                                                      | Apply synchronous builder-to-builder configuration functions |
| `.exitCode()` / `command.exitCode`                                          | Select an integer status instead of the full result          |
| `.run(options?)`, `await builder`                                           | Execute asynchronously                                       |
| `.sync(options?)`                                                           | Execute synchronously, applying the same result selection    |
| `.runner(options?)`                                                         | Get a fresh, lazy ProcessRunner                              |
| `.stream(queueOptions?)`                                                    | Iterate raw chunks or use line-processing operators          |
| `.toString()`, `String(builder)`, `.buildCommand()`                         | POSIX-quoted executable and argv                             |
| `.file` (`.cmd` alias), `.args`, `.options`                                 | Inspect the description                                      |

Arguments may be strings, numbers, booleans or bigints; scalars are converted to
strings. Objects, null, undefined, nested arrays, NUL bytes and empty executable
names are rejected before spawning. Executable names are path strings.

## Options, presets and precedence

```js
const local = command.with({ cwd: '/workspace', mirror: false });
const child = local.with({ env: { ...process.env, MODE: 'test' } });
const builder = child('node', ['-e', 'console.log(process.env.MODE)'])
  .env({ EXTRA: 'value' })
  .pipe(command.options({ timeout: 5000 }), command.capture());
const result = await builder.run({ env: { MODE: 'production' } });

// Shell presets also expose a command factory with the same defaults.
const shell = $({ mirror: false, cwd: '/workspace' });
await shell.command('node', '--version');
```

Precedence is builder defaults, factory presets, array-call options, chained
configuration, then per-execution overrides. Later values win. Explicit `env`
layers merge with each other; setting a key to `undefined` removes it. When `env`
is supplied, it replaces the inherited process environment: include
`...process.env` to extend the parent. An initial `env: {}` starts with an empty environment.
Options and their env maps are copied when bound; later caller edits cannot
change them. Buffers and AbortSignals remain shared resources.

Builders default to `capture:true` and `mirror:false`. ProcessRunner's other
settings apply, including inherited stdin. Inherit/ignore stdout or stderr is
never captured or emitted as data. To both capture and print output, use
`stdout('pipe').capture(true).mirror(true)`. With `capture:false`, events and
stream iteration still receive piped output, while the result retains no output.

All ProcessOptions are accepted through `.with()`, factory presets and run/runner
options: stdio, `cwd`, `env`, `capture`, `mirror`, `preferLocal`, `interactive`,
`signal`, `timeout`, `killSignal`, `killGrace`, `exitPumpGrace`, `detached`, `ansi`,
and `trace`. Shell-specific `loginShell` and `shellOperators` do not turn a
literal builder into a shell command. For shell grammar use the tagged template
API or explicitly execute an interpreter. Synchronous execution follows
ProcessRunner's sync limitations, including unsupported async virtual handlers.
AbortSignal cancellation applies to asynchronous execution; use `timeout` for
synchronous deadlines.

```js
const runner = command('node', ['-e', 'process.stdin.pipe(process.stdout)'])
  .stdin('pipe')
  .runner();
runner.on('stdout', (chunk) => console.log(chunk.toString()));
runner.start();
runner.stdin.end('live input');
await runner;

const source = command('node', '-e', 'console.log("data")').runner();
const sink = command(
  'node',
  '-e',
  'process.stdin.pipe(process.stdout)'
).runner();
const result = await source.pipe(sink);
```

Builder `.pipe()` configures a description. Runner `.pipe()` connects process
streams. `.stream({highWaterMark, highWaterBytes})` configures queue capacity;
configure process options on the builder first. Use `capture:false` for bounded
streaming. The [stream guide](../../docs/stream-processing-guide.md) explains
line framing, backpressure and cancellation.

## Runnable strings and safety

`String(builder)` quotes the executable as well as every argument for a POSIX
shell, preserving empty arguments, apostrophes, whitespace, newlines, `$`, and
shell operators. It renders argv only: environment, cwd, stdio, deadlines and
result selection are execution configuration, not text in the rendered string.
Use the builder directly for portable execution; the rendered string is not
Windows command-line syntax.

Literal argv prevents the shell from interpreting an argument. A target program
may still interpret its own options or code arguments. In particular, calling
`command('sh', '-c', untrustedText)` explicitly asks a shell to execute that text.

## Rust

`command_stream::CommandBuilder` offers owned reusable descriptions with
`arg`, `args`, `cwd`, `env`, `envs`, `env_clear`, `env_remove`, `stdin`, `stdout`,
`stderr`, and `.pipe(|builder| ...)` transforms. `.run().await` and `.run_sync()`
return CommandResult; `.exit_code().await` selects status. `.shell_string()`
renders POSIX argv. Inputs use OsString; captured results are UTF-8 strings.
Use the Rust ProcessRunner, stream, and compatibility APIs for events,
cancellation, pipelines and additional execution options.

## Verification and alternatives

Run `bun test js/tests/command-builder.test.mjs js/tests/advanced-command.test.mjs`,
`node --test js/tests/command-builder.node.test.mjs` and
`cargo test --manifest-path rust/Cargo.toml --test command_builder`.
The tests execute hostile argv and executable paths, the issue example, immutable
presets and env layers, overrides, stdio policies, sync/async selection, events,
pipelines, streaming, timeouts and cancellation.

See the [complete comparison](COMPARISON.md) for competitor APIs across the
library's features and the pinned compatibility corpus for coverage and limits.
