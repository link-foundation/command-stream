# Virtual command ecosystem comparison

Reviewed 2026-10-24 for issue #30. The advantage to evaluate is the complete
workflow: discover a package, install it atomically, create and extend commands,
stream output with backpressure, reload edits, and uninstall without deleting
someone else's replacement. Individual custom-command and streaming features
also exist in competing projects.

## Scope and competing capabilities

The existing [JavaScript comparison](../js/docs/COMPARISON.md) and
[Rust comparison](../rust/docs/COMPARISON.md) cover the repository's complete
competitor inventories and specialized capabilities. This table focuses on
the closest alternatives for virtual commands. “Application code” means the
documented primitives can be composed into the workflow; it does not mean the
workflow is impossible. Absence below means no corresponding integrated API
was found in the linked reference, not proof of absence from every release.

| Project and primary reference                                              | Existing capability                                                                                            | Package ecosystem workflow                                                                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ShellJS](https://github.com/shelljs/shelljs#plugin-api)                   | Third-party npm plugins register shell methods and return pipeable ShellStrings.                               | Real plugin ecosystem; the reference does not document atomic package reload, ownership restoration, or registry discovery as one lifecycle API.                                      |
| [Dax](https://dax.land/#commandbuilder)                                    | `registerCommand`/`registerCommands`, custom `$`, immutable builders, shell pipes, streaming and cancellation. | Custom command registration is a direct competitor. Package discovery, transactional installation, middleware inheritance and reload need application code in the reviewed interface. |
| [zx](https://google.github.io/zx/api)                                      | Typed helpers, custom spawn hooks, process streams, presets and cancellation.                                  | npm modules can share helpers; a shell-command package lifecycle with discovery and atomic hot reload is not documented here.                                                         |
| [Execa](https://github.com/sindresorhus/execa/blob/main/docs/transform.md) | Generator transforms, Node/Web streams, process pipelines and typed execution.                                 | Excellent streaming primitives; command registry ownership, package discovery and reload need application code.                                                                       |
| [Bun Shell](https://bun.sh/docs/runtime/shell)                             | Portable shell syntax and built-ins, pipes, escaping, JS objects in redirects.                                 | Shell interop is supported; the reviewed shell API does not document a handler-package installer, marketplace or transactional command reload.                                        |
| [cmd_lib](https://docs.rs/cmd_lib/latest/cmd_lib/)                         | Rust custom commands with input/output handles, pipelines and command macros.                                  | Custom Rust commands are an existing capability. Registry search, npm manifests and in-process package watching are additional workflows provided by command-stream.                  |

Other audited process libraries supply execution, I/O and application composition;
PTY libraries specialize in expect sessions, and caching libraries specialize in
persistent results. Those strengths remain relevant. The linked full comparisons
and pinned test audits document them instead of treating differently named APIs
as missing features.

The inference from these references is that command-stream offers a broader
integrated virtual-command lifecycle than these documented alternatives.
This is a bounded feature comparison, not evidence of being faster, more widely
adopted, or better than every existing competitor in every workload.

## Executable evidence for issue #30

Both languages implement the lifecycle, using JavaScript handlers/generators and
Rust typed closures/bounded channels. npm providers can ship a JS entry and a
`command-stream.json` literal-argv manifest together. Rust does not evaluate
arbitrary JavaScript exports; its default registry transport requires curl.
See the [JavaScript guide](../js/docs/VIRTUAL-COMMAND-ECOSYSTEM.md) and
[Rust guide](../rust/docs/VIRTUAL-COMMAND-ECOSYSTEM.md) for contracts and examples.

| Requirement                                                     | JavaScript evidence                                                                                                                                                              | Rust evidence                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Packages, install, atomic validation, replacement/restoration   | [Package lifecycle tests](../js/tests/command-packages.test.mjs)                                                                                                                 | [Package tests](../rust/tests/command_packages.rs), [real offline npm installation](../rust/tests/virtual_ecosystem.rs)    |
| Create, extend, middleware, composition and inheritance         | [Ecosystem tests](../js/tests/virtual-ecosystem.test.mjs)                                                                                                                        | [Package tests](../rust/tests/command_packages.rs)                                                                         |
| Incremental producers and paused consumers                      | [Gated generator tests](../js/tests/virtual-ecosystem.test.mjs), [bounded pipelines](../js/tests/advanced-integration.test.mjs)                                                  | [Bounded handlers](../rust/tests/command_packages.rs), [UTF-8 and cancellation](../rust/tests/package_streaming.rs)        |
| Type-safe interfaces                                            | [ESM](../js/tests/types/esm.types.ts), [CommonJS](../js/tests/types/cjs.types.cts)                                                                                               | [Compile-fail interfaces](../rust/src/command_packages.rs) and compiled typed examples                                     |
| Real registry discovery and transport failures                  | [Registry tests](../js/tests/virtual-ecosystem.test.mjs)                                                                                                                         | [Real HTTP/injected transport tests](../rust/tests/virtual_ecosystem.rs)                                                   |
| Hot reload, bad edits, symlinks and watcher shutdown            | [Reload and watcher tests](../js/tests/advanced-integration.test.mjs)                                                                                                            | [Manifest watcher tests](../rust/tests/virtual_ecosystem.rs)                                                               |
| Git helpers, colored ls, custom deployment, enterprise examples | [Ten packages](../js/examples/packages/README.md), [color middleware](../js/examples/ls-color-middleware.mjs), [enterprise demo](../js/examples/enterprise-virtual-commands.mjs) | [Ten package tests](../rust/tests/example_packages.rs), [enterprise demo](../rust/examples/enterprise_virtual_commands.rs) |

The executable `command-packages` feature compares shared observations across
Node, Bun and Rust. Full/core ESM/CommonJS registration tests also protect the
shared core extraction and configured builder defaults when merging main.

Run from the repository root:

```sh
bun test js/tests/command-packages.test.mjs js/tests/virtual-ecosystem.test.mjs js/tests/advanced-integration.test.mjs --timeout 10000
cargo test --manifest-path rust/Cargo.toml --test command_packages --test virtual_ecosystem --test example_packages --test package_streaming
node scripts/check-parity.mjs
```

Ten independently installable example packages and enterprise demonstrations are
included. Ten independent registry publications, external developer adoption,
and enterprise production use are not established by these tests. They remain
unverified success metrics; the library release does not itself publish those
packages. A universal superiority claim likewise remains unverified. The pull
request should stay unmerged if those external outcomes are required for closure.
