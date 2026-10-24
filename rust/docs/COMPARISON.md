# Rust command execution comparison

This comparison covers all fourteen projects in the [pinned Rust
audit](COMPETITOR_TEST_AUDIT.md), using their linked public documentation and
the audited source revisions. Reviewed 2026-10-24. It covers execution, output,
configuration, process control, shell syntax, testing and development tools.
The [JavaScript comparison](../../js/docs/COMPARISON.md) covers the separate
JavaScript APIs; a JavaScript compatibility import is not a Rust implementation.

## Construction, execution and output

| Project / primary reference                                               | Construction and execution                                                                                                   | I/O and composition                                                                                                      | Configuration and lifecycle                                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| command-stream                                                            | Reusable owned `CommandBuilder`, `.arg/.args`, functional `.pipe`, async `.run` and `.run_sync`; separate macros and runners | Builder collects text; `StreamingRunner` yields bytes; `Pipeline` connects processes; Execa module provides byte results | Builder cwd, native environment, clear/remove and three stdio modes; runner exposes cancellation, deadlines and process cleanup        |
| [std::process](https://doc.rust-lang.org/std/process/struct.Command.html) | Reusable mutable native argv builder; `output`, `status`, `spawn`                                                            | Byte results, native handles; construct pipelines using handles                                                          | Native cwd/env/clear/remove, platform extension traits, child wait/try_wait/kill and native ExitStatus                                 |
| [Tokio process](https://docs.rs/tokio/latest/tokio/process/index.html)    | Native-style command builder, async status/output/wait                                                                       | Async native stdin/stdout/stderr and byte output; compose with Tokio I/O                                                 | Native configuration and platform extensions, kill_on_drop; deadlines via Tokio time primitives                                        |
| [async-process](https://github.com/smol-rs/async-process)                 | Async native-style command builder, output/status/spawn                                                                      | Async I/O traits, byte results and line reading through buffered readers                                                 | Native configuration; background reaper; child lifecycle controls                                                                      |
| [duct](https://github.com/oconnor663/duct.rs)                             | Reusable command expressions; run/read/start; nonzero exits checked by default                                               | Expression pipelines, redirects, stderr merging, incremental readers                                                     | cwd/env/clear/remove, handles and unchecked status policy                                                                              |
| [subprocess](https://github.com/hniksic/rust-subprocess)                  | Exec and pipeline builders; join/capture/start                                                                               | OS pipelines, arbitrary reader/byte input, merged streams, concurrent communicate with size/time limits                  | cwd/env, redirects, process groups, nonblocking polling and shared process handles                                                     |
| [xshell](https://github.com/matklad/xshell)                               | Shell context and `cmd!` macro with scalar/collection interpolation; run/read/output                                         | Captured output and pipe input; scripting and filesystem helpers                                                         | Context cwd/env, per-command settings, checked execution and deadline support                                                          |
| [rust_cmd_lib](https://github.com/rust-shell-script/rust_cmd_lib)         | Compile-time command macros, vector arguments, command groups and custom functions                                           | Pipelines, redirections, captured function results and background process groups                                         | Scoped cwd/env, logging, checked pipeline execution; no external shell required for macro grammar                                      |
| [run_script](https://github.com/sagiegurari/run_script)                   | Script text plus args/options, run/spawn functions and macros                                                                | Script output or native spawned child streams; grammar supplied by an interpreter                                        | Interpreter and script options; native child lifecycle via spawn                                                                       |
| [rust-shell](https://github.com/google/rust-shell)                        | ShellCommand macros, checked run, native child and thread helpers                                                            | UTF-8 convenience capture and native process output                                                                      | Environment expansion and signals; upstream documents Unix-only support                                                                |
| [shellfn](https://github.com/synek317/shellfn)                            | Attribute macros turn scripts into Rust functions                                                                            | Arguments mapped through environment; output converted into declared Rust return types                                   | Interpreter/script attributes and domain-specific parsing/error conversion                                                             |
| [bkt](https://github.com/dimo414/bkt)                                     | Command invocation with persistent caching                                                                                   | Cached stdout, stderr and status                                                                                         | TTL, stale refresh and cache keys incorporating selected command state; a different execution policy from always running a description |
| [assert_cmd](https://github.com/assert-rs/assert_cmd)                     | Native command wrapper for CLI integration tests and Cargo binary discovery                                                  | Buffered stdin/output, predicates and readable assertion failures                                                        | Native command settings, deadlines and test-oriented status checks                                                                     |
| [rexpect](https://github.com/rust-cli/rexpect)                            | Interactive sessions and shell helpers                                                                                       | PTY send/read, string/regex/EOF expectations and prompt synchronization                                                  | Session/read deadlines and interactive signal handling                                                                                 |
| [expectrl](https://github.com/zhiburt/expectrl)                           | Interactive session API with optional async support                                                                          | Pattern expectations, logging, control codes and interactive forwarding                                                  | Session controls and timeouts; upstream documents Windows support                                                                      |

The table names each library's useful surface, not interchangeable signatures.
For example, duct's `.pipe` connects expressions; CommandBuilder's `.pipe`
applies a configuration transform. The latter's process pipelines use a runner
or `Pipeline`. Nonzero exit policies also differ: CommandBuilder returns status;
call `error_for_status()` when failure should become an error.

## Builder guarantees and boundaries

`CommandBuilder` executes native `OsString` executable names, arguments and
environment keys/values. Configuration is owned and cloning preserves a saved
description. Environment changes are replayed in order through native Command,
including Windows case-insensitive names. Async and sync executions share the
same native configuration. Buffered text stdin is written while stdout/stderr
are drained, including input larger than a pipe buffer.

| Requirement                                                                          | Public command-stream surface and verification                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Literal argv, configuration transforms, repeated sync/async runs                     | [Builder tests](../tests/command_builder.rs), [builder source](../src/command_builder.rs)                                            |
| Empty/hostile arguments, cwd, environment replacement/removal and platform key rules | [Portable compatibility tests](../tests/competitor_compatibility/behavior.rs)                                                        |
| Byte input and lossless collected output, richer process options                     | [Rust Execa guide](../../js/docs/EXECA_MIGRATION.md#rust); core builder stdin/results remain text                                    |
| Streaming, cancellation, deadlines, signals and descendants                          | [Rust guide](../README.md#streaming), `StreamingRunner`, ProcessRunner and RunOptions; these are separate from builder configuration |
| Arbitrary caller-supplied stdio handles or native child inspection                   | Use native std/Tokio process APIs; the builder has fixed pipe/inherit/ignore output policies and returns CommandResult               |
| Array/splat macros and typed expression pipelines                                    | Builder `.args` accepts iterators; core macros and pipelines have their own grammar and do not implement xshell/cmd_lib/duct macros  |
| Pattern-based interactive PTY sessions                                               | Terminal capture records scripted sessions; it does not implement rexpect/expectrl's expect protocol                                 |
| Persistent subprocess cache or script-to-domain return conversion                    | Application code or specialized bkt/shellfn APIs; running a builder always executes the command                                      |

`.shell_string()` renders POSIX argv, omitting execution configuration. It uses
lossy text conversion for non-UTF-8 native values; execute the builder to retain
native bytes. It is not a Windows command-line serializer.

## Features beyond the process builder

The combined command, stream and tooling APIs are the main breadth advantage.
Native process crates remain useful for direct OS control; specialized crates
offer contracts beyond this builder.

| Area                                                               | command-stream evidence                                                                                                                               | Corresponding competitor approach                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shell parsing, redirects and portable built-ins                    | [Rust guide](../README.md), [generated feature catalog](../../docs/README.md)                                                                         | cmd_lib macro grammar; xshell scripting helpers; run_script/shellfn host interpreters; native runtimes require application composition |
| Custom commands, middleware and command environments               | [Advanced workflows](../../js/docs/ADVANCED-WORKFLOWS.md#rust-equivalents)                                                                            | cmd_lib custom command functions; ordinary Rust functions around the other APIs                                                        |
| Async transforms, batching, windows, bounded queues and statistics | [Stream processing guide](../../docs/stream-processing-guide.md)                                                                                      | Tokio/async-process I/O plus stream combinators; duct/subprocess readers plus application transforms                                   |
| ANSI processing, terminal snapshots and recording                  | [Feature catalog](../../docs/README.md)                                                                                                               | rexpect/expectrl specialize in interactive expectations; native APIs supply the underlying I/O                                         |
| Shell translation, examples and development workflows              | [Translation guide](../../js/docs/FY.md), [native Cargo watching and Evcxr REPL](../../js/docs/ADVANCED-WORKFLOWS.md#rust-equivalents)                | Script macros and integration with external development tools; browser/VS Code tools belong to the JavaScript package                  |
| CLI assertions and mocks                                           | [Portable integration tests](../tests/competitor_compatibility/behavior.rs) use ordinary Rust assertions; the JS mock/snapshot helper API is separate | assert_cmd provides Cargo-aware command discovery and predicate assertions; expect libraries test interactive protocols                |
| Performance and memory                                             | [Rust benchmark guide](../benchmarks/README.md)                                                                                                       | Compare the same output, workload, platform and build configuration before making a performance claim                                  |

The audit accounts for every test unit in its published discovery set. It does
not establish superiority over every open-source project or full conformance to
every upstream API. The missing-contract entries identify specialized behavior
and verification limits; passing a portable invariant does not prove all of a
competitor's implementation or platform contracts.
