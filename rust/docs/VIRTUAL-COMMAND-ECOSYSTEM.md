# Rust virtual command ecosystem

`CommandEnvironment` supports the same ecosystem workflows as JavaScript:
packages, custom commands, middleware, inheritance, composition, incremental
output, registry discovery and development reload. Rust uses typed async
closures and exact-argv JSON manifests; JavaScript uses module exports and
generators. The [JavaScript guide](../../js/docs/VIRTUAL-COMMAND-ECOSYSTEM.md)
describes its corresponding interfaces.

## Create, extend and compose

```rust
use command_stream::{commands::CommandContext, CommandEnvironment, CommandResult};

# async fn example() -> Result<(), String> {
let mut environment = CommandEnvironment::new();
environment.create("hello", |context| async move {
    CommandResult::success(context.args.join(" "))
})?;
environment.inherit("greet", "hello", vec!["developer".into()])?;
environment.extend("greet", |context, next| Box::pin(async move {
    let mut result = next(context).await;
    result.stdout = format!("[greeting] {}", result.stdout).into();
    result
}))?;
environment.compose("pipeline", &["greet", "cat"])?;
let result = environment.run("pipeline", CommandContext::new(vec!["Alice".into()])).await;
assert_eq!(result.stdout, "[greeting] developer Alice");
# Ok(())
# }
```

Names match `[A-Za-z_][A-Za-z0-9_:.-]*`; invalid names return an error before
registry mutation. Non-string names and non-callable handlers cannot compile,
and compile-fail documentation tests protect those interfaces. `create` replaces
an existing custom command; `unregister` removes it. Unknown commands return
status 127. Built-ins are available through `get` and `run`.

Middleware receives `(context, next)` and can validate or modify the context,
await the parent, transform its result, or forward its output channel. The newest
extension is outermost. Inheritance captures the current parent and prepends
default arguments. Composition captures stdout between stages, including chunks
from streaming producers, forwards stdin/cwd/env/cancellation, and stops on a
nonzero exit status. It drains bounded channels while executing a stage and
keeps intermediate output inside the composition.

## Incremental output and cancellation

Set `CommandContext.output_tx` to a bounded Tokio `mpsc::Sender<StreamChunk>`.
An async handler awaits `send` for each output chunk and returns a final
`CommandResult`. Consume the receiver concurrently with execution. This is the
Rust counterpart of an async generator: consumers receive chunks before the
handler finishes, and a bounded channel pauses a producer when consumers pause.
Middleware and inheritance preserve this channel. Return an empty stdout when
emitting through the channel to avoid duplicate captured output.

`CommandContext.is_cancelled` supplies a shared cancellation check. Composition
preserves it; user handlers should check it during long-running work. Manifest
handlers and `argv_handler(file, args)` stream literal-argv subprocess output,
apply stdin/cwd/env, and stop a child when cancellation or consumer closure is
observed. With no output channel they capture stdout/stderr in the result.

## Packages, installation and atomic reload

Typed packages use `CommandPackage { name, version, commands }`, where commands
map names to `PackageHandler` closures. `environment.install(package)` validates
every name and collision, including built-ins, before changing the registry.
Reinstalling a package replaces its owned handlers. Invalid replacements preserve
the working version. `installed(name)` exposes its metadata and handlers.

For intentional replacement, use
`install_with_options(package, InstallOptions { replace: true })`. Uninstall
restores displaced custom handlers and falls back to built-ins. Handlers changed
externally by `create` or `extend` survive uninstall. Removed commands disappear
after successful reload.

A JSON manifest defines external commands without dynamic linking or a
JavaScript runtime:

```json
{
  "name": "git-tools",
  "version": "1.0.0",
  "commands": {
    "git-summary": { "file": "git", "args": ["status", "--short"] },
    "git-recent": { "file": "git", "args": ["log", "-5", "--oneline"] }
  }
}
```

`CommandPackage::load(path).await` loads a definition without registration.
`environment.install_file(path).await` resolves a canonical file identity and
installs it once, including through symlinks. `reload_file(path).await` rereads
the manifest and atomically replaces that package. Syntax errors, invalid names,
and collisions preserve the previous version. A reload keeps its package name;
uninstall before installing a renamed package. Each installed manifest package
has one canonical source file.

`environment.install_npm("@my-org/git-tools", cwd, true).await` resolves
`node_modules/@my-org/git-tools/command-stream.json`, installing a missing npm
package with lifecycle scripts disabled. Pass `false` to require an existing
package. Scoped names and version specifiers work. Providers targeting both
languages can ship a JavaScript entry and this manifest in the same npm package.
Only packages shipping a Rust manifest support this installation path; arbitrary
JavaScript handlers need a corresponding typed Rust package or executable command.
Keep the `command-stream-command` keyword for discovery. Rust applications may
also distribute typed packages as ordinary crates through Cargo.

## Registry discovery

```rust,no_run
use command_stream::command_packages::{Marketplace, SearchOptions};
# async fn example() -> Result<(), String> {
let packages = Marketplace::search("git", SearchOptions::default()).await?;
for package in packages {
    println!("{}@{}: {}", package.name, package.version, package.description);
}
# Ok(())
# }
```

The default transport calls curl with exact argv and queries npm's real search
endpoint. Curl must be on PATH. `SearchOptions` accepts an HTTP(S) registry
origin, clamps `size` to 1–250, and accepts a Tokio watch cancellation receiver
(`true` aborts the request). Queries are UTF-8 percent-encoded. Results expose
typed name/version/description fields and preserve other registry metadata.
Network, HTTP and malformed-response errors propagate. `Marketplace::search_with`
accepts an async transport returning decoded registry JSON, allowing an
application's HTTP client or deterministic test transport.

Discovery returns registry metadata; a result may provide JavaScript only.
Inspect the provider's documented Rust manifest or crate before installation.

## Development reload and shutdown

`watch_package(Arc<RwLock<CommandEnvironment>>, path, interval).await` installs
a manifest and establishes its initial snapshot before returning a
`PackageWatcher`. Edits and atomic file replacements trigger `reload_file` inside
the existing process. Failed edits emit error events while preserving working
handlers. `next_event()` returns `Result<package_name, error>`, and `close().await`
stops watching and waits for outstanding reload work. Dropping the watcher also
requests shutdown. Use intervals of at least 10ms and atomic editor saves.

Typed Rust source changes use the existing Cargo watcher and REPL; see
the [interactive development guide](../../js/docs/INTERACTIVE-DEVELOPMENT.md).

## Examples and acceptance coverage

Run these from the repository root:

```sh
cargo run --manifest-path rust/Cargo.toml --example virtual_ecosystem
cargo run --manifest-path rust/Cargo.toml --example enterprise_virtual_commands
cargo test --manifest-path rust/Cargo.toml --test command_packages --test virtual_ecosystem --test example_packages --test package_streaming
```

The [ten typed example packages](../examples/packages/mod.rs) cover Git, files,
deployment plans, JSON, text, HTTP, logs, time, environment, and math. The ecosystem
demo installs them and demonstrates inheritance, middleware and composition;
`--search` enables real registry access. The enterprise demo validates an
environment and streams an audited deployment plan through a bounded channel.
Git requires git; HTTP examples require curl. Both demos run offline by default.

| Requirement                                                     | Rust coverage                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Packages, install/create/extend, collisions and ownership       | [Package tests](../tests/command_packages.rs), [npm and manifest tests](../tests/virtual_ecosystem.rs)            |
| Composition, inheritance and middleware                         | [Package tests](../tests/command_packages.rs), [executable feature comparisons](../examples/language_features.rs) |
| Incremental output and bounded producers                        | [Gated streaming and composition tests](../tests/command_packages.rs)                                             |
| Process streaming, split UTF-8 and paused-consumer cancellation | [Manifest streaming tests](../tests/package_streaming.rs)                                                         |
| Type-safe command interfaces                                    | `create` compile-fail doctests and compiled typed package examples                                                |
| Marketplace queries, metadata, errors and cancellation          | [Injected and real HTTP transport tests](../tests/virtual_ecosystem.rs)                                           |
| Manifest hot reload, symlinks, invalid edits and shutdown       | [Watcher tests](../tests/virtual_ecosystem.rs), [Cargo watcher tests](../tests/development.rs)                    |
| Ten packages and enterprise workflows                           | [Example package tests](../tests/example_packages.rs), both runnable demonstrations                               |

Publication counts, external adoption and enterprise use remain post-release
outcomes. The examples demonstrate those workflows without claiming publication
or contacting a production deployment service.
