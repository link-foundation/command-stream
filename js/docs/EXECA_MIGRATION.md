# Migrating from Execa

The isolated `command-stream/execa` entry point exports the **Execa 9.6.1 API**.
It delegates to the pinned production dependency: result types, subprocess
methods, errors, transformations, IPC, cancellation, and execution options keep
Execa's behavior. The native command-stream shell remains available alongside it.

```js
// Before:
import { execa, execaSync, execaNode, $ } from 'execa';

// After:
import { execa, execaSync, execaNode, $ } from 'command-stream/execa';
```

Execa targets Node.js. Ordinary execution also runs in Bun, but Execa 9.6.1's
IPC helpers rely on Node's counted IPC-channel references, which Bun does not
implement. Use Node for IPC; for non-IPC `execaNode` calls in Bun, pass
`{ ipc: false }`. Deno compatibility is not claimed for this entry. These
upstream runtime limits are preserved, and IPC tests run in Node CI.

CommonJS uses `require('command-stream/execa')`. Like the Bun and zx entries,
this uses `require(esm)` and needs Node >=20.19 or >=22.12, or Bun.

## Using the general API

```js
import { $, execa, execaCompat } from 'command-stream';

await execa('git', ['status', '--short']);
await $.execa('git', ['status', '--short']);
const api = execaCompat(); // also $.execaCompat()
const result = await api.$`node --version`;
```

The general entry loads Execa on first use. Its named `execa`, `execaSync`,
`execaNode`, `execaCommand`, and `execaCommandSync` functions forward to the same
implementation as the isolated entry. The original `$` still creates native
command-stream runners with their original defaults.

`execaCompat().create(options)` and `execaCompat(options)` bind reusable defaults
for all execution methods, including `$`. `create(overrides)` merges additional
defaults. Execa's own `execa(options)` and `$(options)` presets also work.
`isExecaChildProcess(value)` checks the live subprocess API, rather than treating
any object with a `pid` as an Execa subprocess.

## Common patterns

| Pattern           | Execa-compatible entry                                          | Native command-stream API                                 |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Exact argv        | `execa(file, args)`                                             | `exec(file, args)`                                        |
| Shell operators   | `execa('sh', ['-c', script])`                                   | `$` template with operators                               |
| Reusable defaults | `execa(options)`                                                | `$(options)`                                              |
| Nonzero exit      | Rejects by default; `reject: false` returns a result            | Returns a result; `shell.errexit(true)` enables rejection |
| Final newline     | Strips one final LF/CRLF by default                             | Preserves output                                          |
| Binary output     | `encoding: 'buffer'` returns `Uint8Array`                       | Consume buffers from `runner.stream()`                    |
| Line output       | `lines: true`, or `for await (const line of subprocess)`        | Consume typed chunks and split lines if needed            |
| Stdin             | `input`, `inputFile`, writable `subprocess.stdin`               | `stdin`, `writeStdin()` / `closeStdin()`                  |
| Streaming         | Readable streams, async line iteration, generators, `.duplex()` | Typed stdout/stderr/exit chunks, events                   |
| Pipes             | `subprocess.pipe(file, args)` or tagged `.pipe`                 | Native `.pipe()` or shell pipelines                       |
| Cancellation      | `cancelSignal`, `.kill()`, `timeout`                            | Abort `signal`, `.kill()`, leaving a stream loop          |
| IPC               | `execaNode`, `sendMessage`, `getOneMessage`, `getEachMessage`   | Use the isolated Execa API                                |
| Virtual commands  | Executables only                                                | `register(name, handler)` and native pipelines            |

All upstream exports are retained, including `ExecaError`, `ExecaSyncError`,
`parseCommandString`, `sendMessage`, `getOneMessage`, `getEachMessage`, and
`getCancelSignal`. See the [Execa 9.6.1 API reference](https://github.com/sindresorhus/execa/blob/v9.6.1/docs/api.md)
for the full option and subprocess contracts.

Execa templates parse argv; they do not interpret shell operators. Interpolated
arrays expand to separate arguments. Do not join argv into a string or pre-quote
values: direct execution preserves spaces and metacharacters as literal data.

## Streaming and virtual commands

Execa already supports real-time streams, async iteration and programmatic
pipelines. command-stream adds a native virtual-command registry, built-ins,
and typed chunks including stderr and exit status in a single stream.

Run the finite examples from the repository root:

```sh
node js/examples/execa-vs-async-iteration.mjs
node js/examples/execa-vs-virtual-commands.mjs
node js/examples/streaming-benchmarks.mjs
```

Use the isolated entry for existing Execa scripts; use native `$` when composing
system, built-in and registered commands. A registered JavaScript function does
not become an OS executable visible to Execa or an external system shell.

## Rust

The isolated API is `command_stream::execa`; the general crate re-exports
`execa`, `execa_sync`, `execa_node` and `execa_compat`.

```rust,no_run
use command_stream::execa::{Execa, Options};

# async fn demo() -> Result<(), command_stream::execa::ExecaError> {
let result = command_stream::execa("git", ["status", "--short"]).await?;
println!("{}", result.text());
let api = Execa::new(Options { reject: false, ..Options::default() });
let result = api.command("git", ["status", "--short"]).await?;
assert!(!result.failed);
# Ok(())
# }
```

Rust portable counterparts cover exact argv, async/sync execution, reusable
options, cwd, environment replacement, local executable lookup, binary input,
byte output, newline stripping, lines, combined output, rejection, timeout,
cancellation, bounded capture and live typed streaming. `spawn()` returns a
`Subprocess` with `next()`, `pid()`, `wait_for_pid()`, `kill()` and `wait()`.
`Cancellation` provides a clonable controller and per-command signal.
Call `spawn()` inside Tokio, and poll `next()` or `wait()` to service timeouts
and cancellation.

Rust output is `Vec<u8>`; `text()` / `stderr_text()` decode it and
`stdout_lines()` / `stderr_lines()` return lines. `.sync()` is for code outside
Tokio; async code awaits the command. `.pipe(destination)` buffers the source
before running its destination; use native `Pipeline` for streaming pipelines.
`execa_node` invokes Node with a file and argv but does not emulate JavaScript
IPC helpers. JavaScript generator transforms, web streams, custom fd/stdio
policies and Execa-specific TypeScript overloads have no Rust adapter equivalent.
Rust is a portable counterpart, not a claim of full JavaScript API parity.

## Verification

`js/tests/execa/` covers every upstream runtime export, the adapter factory,
methods, options, errors, templates, exact argv, streams, pipes, transforms,
IPC and cancellation with real processes. `js/tests/execa-compat.test.mjs`
retains the minimum reproductions for the old facade's defects. Strict ESM/CJS
type tests and a packed production-only install check the published entry.
These are public-contract tests, not a port of all Execa's internal tests.
Rust tests cover the portable counterparts and the full-duplex pipe regression.

The old facade incorrectly shell-parsed argv and returned a plain promise
without subprocess methods. Reproduce its behavior from the original PR commit
with `experiments/issue-24/reproduce.mjs <path-to-old-src/$.mjs>`; running the
same script against `js/src/execa/index.mjs` passes.
