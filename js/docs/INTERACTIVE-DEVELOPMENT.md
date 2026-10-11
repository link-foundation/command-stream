# Interactive JavaScript and Rust development

## JavaScript

```sh
npx command-stream repl
npx command-stream dev app.mjs 'scripts/**/*.mjs'
```

The REPL uses Node's evaluator and exposes every export of `command-stream` with
its original identity. Declarations persist between inputs. Classes, constructors,
multiline input, top-level `await`, and `for await` work as ordinary JavaScript.
`.clear` resets variables and restores the library APIs. Use `.help`, `.commands`,
and `.exit`; the bare `help`, `clear`, and `exit` aliases also work.

```js
const result = await $({ mirror: false })`echo hello`;
String(result.stdout);
await stream([1, 2])
  .map((value) => value * 2)
  .toArray();
```

Registered commands also accept bare shell syntax, for example `echo hello | cat`.
Bindings take priority over command names: `const echo = 42` followed by `echo`
evaluates to 42. For ambiguous shell input, use `await sh('git status')` or a `$`
template. Normal JavaScript completion and registered-command completion remain
available. REPL inputs execute with the user's normal process permissions.

## Rust

Install the Rust toolchain, source component, and [Evcxr evaluator](https://github.com/evcxr/evcxr/tree/main/evcxr_repl):

```sh
rustup component add rust-src
cargo install --locked evcxr_repl
```

Start either the JavaScript CLI's Rust mode or the native Rust binary:

```sh
npx command-stream repl --language rust
command-stream repl
```

When running from this repository, pass a local crate to test unpublished changes:

```sh
node js/src/cli.mjs repl --language rust rust
cargo run --manifest-path rust/Cargo.toml -- repl --crate rust
```

Evcxr evaluates actual Rust, retains bindings and types between inputs, reports
compiler diagnostics, and supports multiline editing and completion. Startup
loads the full crate with `use command_stream::*;` and Tokio. Evcxr provides the
runtime for top-level `await`. Startup enables dynamic dependency linking so
Tokio process/signal state is shared between inputs; macros can be fully qualified:

```rust
let retained = 41;
struct Example { value: i32 }
let value = Example { value: retained + 1 };
assert_eq!(value.value, 42);
let result = command_stream::s!("echo hello").await?;
assert_eq!(result.stdout.as_str(), "hello\n");
let values = DataStream::from_values(vec![1, 2]).map(|n| n * 2).collect().await;
assert_eq!(values, vec![2, 4]);
```

Use `:help` and `:quit` for Evcxr commands. `COMMAND_STREAM_EVCXR` selects another
evaluator executable. Each session owns a temporary startup configuration, leaving
the user's Evcxr configuration intact, and removes it when closed. The first
session compiles dependencies and needs registry access; later compilation is
managed by Evcxr. A missing evaluator produces installation instructions.

## Watch and restart

```sh
node js/src/cli.mjs dev rust/Cargo.toml
cargo run --manifest-path rust/Cargo.toml -- dev rust/Cargo.toml
```

Rust mode runs Cargo with the selected manifest and watches Rust sources and
Cargo manifests/lockfiles by default. Pass extra glob arguments to choose another
watch set. Both watchers detect creation, edits, and deletion, debounce changes,
and await termination before restarting. They skip `target`, `node_modules`,
`.git`, and temporary command-stream directories. Child runs do not recursively
start watchers. Ctrl+C or SIGTERM stops development mode. `--repl` adds a Rust
REPL alongside Cargo; quitting it closes the watcher. JavaScript development mode
also opens its REPL automatically on an interactive terminal.

The JavaScript API accepts `dev({language:'rust', entry:'Cargo.toml', cwd})` and
`startRustRepl({cratePath})`. Await `controller.ready` and `controller.close()` for
watchers; await `repl.done` or call `repl.close()` for the Rust evaluator.
The native crate exports `dev(DevOptions)`, `DevEvent`, `start_repl(ReplOptions)`,
and `RustRepl`. Consume `next_event()` to observe restarts/errors, then await
`close()`. Dropping a native controller requests shutdown; explicit close waits
for it. [Native watcher example](../../rust/examples/development.rs).

## Available features

Both REPLs load their language's complete public library. The existing APIs keep
their usual semantics and runtime requirements.

| Feature                                                                | JavaScript REPL                                     | Rust REPL                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Commands, options, built-ins, pipelines, cancellation, streams, events | All public exports                                  | All public exports and modules                                            |
| Literal builders and stream analytics                                  | `command`, `stream`, `merge`                        | `CommandBuilder`, `DataStream`                                            |
| Packages, middleware, virtual commands                                 | `create`, `register`, `install`, `extend`           | `CommandEnvironment`, `CommandPackage`, `commands`                        |
| Terminal capture and buffers                                           | `openTerminal`, `captureTerminal`, `TerminalBuffer` | `terminal` module                                                         |
| Compatibility APIs                                                     | `zx`, `execa`, `shelljs`, `bun`                     | `zx`, `execa`, `shelljs`, `bun_shell` modules with documented limits      |
| Pipeline browser debugger and mock/snapshot helpers                    | `PipelineDebugger`, `testing`                       | These tools are JavaScript package APIs                                   |
| IDE tools                                                              | VS Code extension shell tooling and REPL command    | VS Code extension Rust REPL command; syntax/diagnostics via rust-analyzer |

See [advanced workflows](ADVANCED-WORKFLOWS.md) for browser debugging, profiling,
timeline inspection, IDE integration, mocking, and snapshots. The shared core
feature guide verifies existing command behavior in both languages. Tests cover
every JavaScript export, persistent syntax, virtual pipelines, session isolation,
shutdown, file changes, and real Rust evaluation on Linux CI.
