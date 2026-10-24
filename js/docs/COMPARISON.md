# Command execution API comparison

This comparison covers the complete library: command construction, execution,
streams, shell behavior, process control, compatibility APIs, and development
tools. It describes public capabilities, with links to executable evidence.
A differently named API still counts as support. Process APIs that offer safe
argv, streams or plugins are credited for those features.

## Execution and output

The source links in the column headings are the upstream references, reviewed
2026-10-24. “Via” names an additional public API or adapter needed for the behavior.
“Manual” means application code must compose the underlying primitives. A dash
means no corresponding API is documented in that reference, not that application
code could never implement the behavior.

| Capability                        | command-stream                                                               | [Execa](https://github.com/sindresorhus/execa)  | [cross-spawn](https://github.com/moxystudio/node-cross-spawn) | [Bun Shell](https://bun.com/docs/runtime/shell) | [ShellJS](https://github.com/shelljs/shelljs) | [zx](https://google.github.io/zx/api) |
| --------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| Literal executable + argv         | `command`, `exec`, `spawn`                                                   | `execa(file, args)`                             | `spawn(file, args)`                                           | Via `Bun.spawn`                                 | `cmd(file, ...args)` and shell built-ins      | Escaped templates / argv-array calls  |
| Tagged templates                  | `$`, `bun.$`, `zx.$`, Execa `$`                                              | `$`, `execa`                                    | —                                                             | `$`                                             | —                                             | `$`                                   |
| Lazy reusable command description | Immutable `command` builder                                                  | Bound defaults; subprocess execution API        | Manual                                                        | ShellPromise with fluent options                | Manual                                        | Lazy process/presets (`halt`)         |
| Functional builder transforms     | `builder.pipe(command.stdout(...), command.exitCode)`                        | Options and pipeline API                        | Manual                                                        | Fluent ShellPromise                             | Fluent ShellString                            | Fluent ProcessPromise                 |
| Async / sync execution            | `run` / `sync`, compatibility entries                                        | `execa` / `execaSync`                           | `spawn` / `sync`                                              | Async ShellPromise; sync via Bun.spawnSync      | Sync or callback `exec`                       | `$` / `$.sync`                        |
| Captured text / bytes             | `text`, captured streams / raw stream chunks                                 | Configurable text or bytes                      | Collect child streams                                         | ShellOutput / `text`, `bytes`                   | ShellString                                   | ProcessOutput / bytes and text        |
| Live output                       | Events, Node streams, async chunks                                           | Node/Web streams, events                        | Child stdout/stderr streams                                   | Inherited output; `lines()`                     | Async exec child streams                      | ProcessPromise streams                |
| Async line iteration              | `.stream().lines()` / fluent operators                                       | Progressive iteration                           | Readable stream + framing                                     | `lines()`                                       | Manual framing                                | `lines()` / iterator                  |
| Events and awaited result         | ProcessRunner; `runner()` from builder                                       | Child events + promise                          | Child events; manual promise                                  | Promise and line API                            | Async exec events + callback                  | ProcessPromise events + promise       |
| stdin policies and data           | Inherit/ignore/pipe, strings, Buffer, live writable; richer inputs via Execa | Files, streams, iterables, objects, text, bytes | Node stdio                                                    | Shell redirects and JS objects                  | ShellString pipes; exec child stdin           | Input data, streams, process results  |
| Separate / interleaved stderr     | Separate core streams; `all` via Execa                                       | Separate and `all`                              | Separate streams; manual interleave                           | Redirection, ShellOutput stderr                 | ShellString stderr                            | Separate and combined ProcessOutput   |
| Capture and print together        | `capture:true`, `mirror:true`                                                | Configurable stdout/stderr                      | Manual tee                                                    | Default inherited output plus result            | Configurable silent mode                      | `quiet:false` and ProcessOutput       |
| Real process pipelines            | Runner `.pipe`, shell pipes, compatibility APIs                              | `.pipe`, multiple sources/destinations          | Pipe child streams                                            | Shell `\|`                                      | ShellString methods / shell pipes             | `.pipe`, shell pipes                  |
| Output transforms / backpressure  | Async map/filter/reduce, batch/window/split/merge, bounded queues            | Transform functions, streams                    | Node streams                                                  | Shell stages / line iteration                   | String/array transforms                       | Node stream transforms                |
| Stream statistics                 | Incremental throughput/error/latency statistics                              | Application transform                           | Application stream                                            | Application iteration                           | Application code                              | Application stream                    |

## Configuration, shell behavior and lifecycle

| Capability                           | command-stream                                                                      | Execa                                     | cross-spawn                    | Bun Shell                        | ShellJS                                          | zx                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ | -------------------------------- | ------------------------------------------------ | ------------------------------ |
| cwd / environment / presets          | Builder methods/transforms/options, `create`, `$({...})`                            | Options and bound defaults                | Spawn options                  | `cwd`, `env`, defaults           | `cd`, `env`, config                              | Options and chained presets    |
| Argument safety                      | Exact argv builder; escaped templates; explicit raw escape hatch                    | Exact argv by default                     | Exact argv with shell disabled | Escaped interpolation            | Literal `cmd`; shell-source `exec` needs quoting | Escaped interpolation          |
| Shell grammar and redirects          | Tagged core parser; full Bun compatibility entry                                    | Opt-in shell                              | Opt-in shell                   | Cross-platform shell interpreter | Host shell exec + built-ins                      | Host shell                     |
| Portable shell commands              | 26 core commands; Bun and ShellJS entries                                           | System utilities                          | System utilities               | Built-in utilities               | Portable Unix commands                           | System utilities               |
| Custom commands                      | Registry, generators, middleware and packages                                       | JS transforms                             | Child programs                 | JS objects in redirections       | Plugin API                                       | Custom spawn and helpers       |
| Nonzero status                       | Core returns code; shell errexit and adapter policies                               | Rejects by default, configurable          | Exit event / status            | Throws by default, configurable  | Configurable fatal policy                        | Throws by default, nothrow     |
| Timeout and abort                    | ProcessOptions; builder overrides; adapter options                                  | timeout, signal, graceful cancel          | Spawn timeout/signal           | Via Bun process controls         | exec options/child control                       | timeout, signal, kill controls |
| Signals and process trees            | Configurable signal/grace and tree cleanup                                          | Graceful termination and cleanup          | ChildProcess lifecycle         | Runtime process controls         | ChildProcess for async exec                      | ProcessPromise kill controls   |
| Detached process / live stdin / PID  | Core and builder runner                                                             | Process API options                       | ChildProcess                   | Bun.spawn                        | Async exec child                                 | ProcessPromise                 |
| Local executable resolution          | `preferLocal`, spawn/Execa entries                                                  | preferLocal                               | PATH, PATHEXT, shebang support | Runtime resolution               | PATH / which                                     | preferLocal                    |
| Low-level fd / IPC / credentials     | `spawn` or Execa entry                                                              | Rich spawn/IPC options                    | Node spawn options             | Bun.spawn options                | Exec child/options                               | Spawn options/hooks            |
| ANSI, terminal snapshots / recording | ANSI config, headless terminal, recording                                           | Output options; external terminal tooling | External terminal tooling      | Runtime terminal APIs            | External terminal tooling                        | External terminal tooling      |
| Tracing and diagnostics              | Disabled-by-default trace, process/stream/debugger tools                            | Verbose/custom logging                    | Child events                   | Runtime diagnostics              | Verbose/config                                   | Verbose/custom log             |
| Typed ESM / CommonJS                 | Bundled strict declarations; shared entry identity                                  | Typed package exports                     | Node/@types integration        | Runtime types                    | @types/shelljs                                   | Bundled types                  |
| Runtime and platform checks          | Node/Bun Linux/macOS/Windows CI; Deno CDN compatibility probes; separate Rust crate | Node library; runtime behavior varies     | Node spawn contract            | Bun runtime                      | Node library                                     | Node/Bun/Deno                  |

Core builder options are documented in [COMMAND-BUILDER.md](COMMAND-BUILDER.md).
Core ProcessRunner, Bun compatibility, zx compatibility, ShellJS compatibility,
Execa compatibility and cross-spawn have distinct option/result contracts. Use
[the migration guides](../README.md#features) when running existing scripts.
For example, Execa's stream inputs and configurable output encoding belong to
`command-stream/execa`; passing those names to a core builder does not silently
implement an Execa option. The full package integrates the actual Execa method;
its runtime limits are recorded in [EXECA_MIGRATION.md](EXECA_MIGRATION.md).

## Other tracked command APIs and the issue's references

All twelve projects selected by the repository's published discovery rule are
covered here or above. The [pinned audit](COMPETITOR_TEST_AUDIT.md) records their
exact commits, portable process invariants, API-specific exclusions and gaps.
Effect and Rust Command are included because issue #34 explicitly references
them, regardless of their inclusion in that discovery set.

| Project and primary reference                                                                | API and strengths                                                                            | Corresponding command-stream surface                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Node child_process](https://nodejs.org/api/child_process.html)                              | argv, streams/events, sync calls, fd/IPC, process credentials and lifecycle                  | Core exec/runner; cross-spawn export for the native spawn contract                                                         |
| [Deno.Command](https://docs.deno.com/api/deno/subprocess/)                                   | Reusable argv/options object, output/outputSync/spawn, Web streams, clearEnv                 | Literal builder, runner/stream, explicit replacement env; Deno CDN support is integration-tested                           |
| [Dax](https://github.com/dsherret/dax) and [@david/shell](https://github.com/dsherret/shell) | Shell builders, portable built-ins, presets, streaming; Dax adds requests/prompts            | Builder, Bun interpreter, command registry and Node/Bun APIs; no Dax import shim                                           |
| [nano-spawn](https://github.com/sindresorhus/nano-spawn)                                     | Small dependency-free process API, line iterator, piping and interleaved output              | Builder/runner/stream; interleaving via Execa; core subpath reduces loaded modules but is not dependency-free              |
| [@actions/exec](https://github.com/actions/toolkit/tree/main/packages/exec)                  | argv, listeners, CI output and captured status                                               | Runner events/results and mirror; no Actions-specific logger shim                                                          |
| [cross-env](https://github.com/kentcdodds/cross-env)                                         | Portable inline environment assignments in package scripts                                   | Explicit env options; tagged Bun interpreter for shell assignments; no cross-env CLI replacement                           |
| [Effect platform Command](https://effect.website/docs/v3/platform/command)                   | Immutable `make`, functional pipes, environment/stdio, scoped effect execution and streaming | Immutable `command`, configuration transforms, exit-code selection, runner streams; no Effect runtime dependency           |
| [Rust std::process::Command](https://doc.rust-lang.org/std/process/struct.Command.html)      | Native argv/OsString, env clear/removal, stdio handles, status/output/spawn                  | Rust CommandBuilder and ProcessRunner, plus reusable async/sync descriptions; native std handles remain available directly |

## Features beyond a process wrapper

command-stream combines several layers in one package, and provides portable
counterparts in Rust. The following links lead to runnable examples and output:

| Feature area                                                              | Public guide / executable evidence                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Every catalog feature and equivalent competitor snippets                  | [Generated feature guide](../../docs/README.md)                                                                               |
| Exact argv, templates, sync, callbacks/events, iteration and pipelines    | [Builder guide](COMMAND-BUILDER.md), [core guide](CORE.md), [compatibility tests](../tests/competitor-compatibility.test.mjs) |
| ShellJS, zx, Execa and Bun script APIs                                    | [ShellJS](SHELLJS_MIGRATION.md), [zx](ZX_MIGRATION.md), [Execa](EXECA_MIGRATION.md), [Bun](BUN_SHELL.md)                      |
| Virtual commands, typed packages, composition, inheritance and middleware | [Advanced workflows](ADVANCED-WORKFLOWS.md)                                                                                   |
| Stream batches/windows, backpressure, monitoring and statistics           | [Stream guide](../../docs/stream-processing-guide.md)                                                                         |
| ANSI processing, live terminal buffers and recordings                     | [Feature catalog](../../docs/README.md)                                                                                       |
| Shell-to-module translation and executable scripts                        | [Translation guide](FY.md)                                                                                                    |
| REPL, watch/reload, browser pipeline debugger and VS Code tools           | [Development guide](INTERACTIVE-DEVELOPMENT.md)                                                                               |
| Command mocks, pipeline assertions and snapshots                          | [Advanced workflows](ADVANCED-WORKFLOWS.md)                                                                                   |
| Cold import/module budget                                                 | [Core entry](CORE.md), [automated module-budget tests](../tests/core-entry.test.mjs)                                          |
| Process latency, memory, package size, features and real workloads        | [JavaScript benchmarks](../benchmarks/README.md), [Rust benchmarks](../../rust/benchmarks/README.md)                          |

Rust's [competitor audit](../../rust/docs/COMPETITOR_TEST_AUDIT.md) also covers
Tokio, async-process, duct, subprocess, xshell, rust_cmd_lib, rust-shell,
run_script, shellfn, bkt, assert_cmd, rexpect and expectrl. The audit records
contracts such as binary collection, arbitrary handles, expect sessions,
persistent result caching and typed domain adapters that the core does not
claim to replace. JavaScript compatibility imports are not Rust modules.

## Assessing the comparison

The combination of immutable literal builders, multiple compatibility APIs,
custom shell commands, stream analytics and development tools is the useful
advantage to evaluate. A global “faster/smaller/better than every competitor”
claim is not established by API presence or passing tests. The repository's
benchmarks validate identical output before recording timings, publish raw
measurements and compare base/head on the same runner. Use those reports for
a specific workload and the missing-feature ledgers for specialized contracts.
Neither upstream test accounting nor adapter availability is a claim that every
upstream test or every platform contract runs unchanged against the core API.
