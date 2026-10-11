# Issue 32: complete language evaluation

## Reproduction

The updated PR request asks for JavaScript and Rust syntax and access to all
existing library features. Main already supplied JavaScript development/debugging
tools. Its REPL passed only a small hand-maintained API object and classified
classes and `new` expressions as shell input. The native Rust CLI interpreted
`repl` as an ordinary shell command.

Before the fix, `js/tests/repl.test.mjs` failed the complete-export, persistent
class/constructor, streaming API, and command-registration regressions.
`rust/tests/development_cli.rs` failed both the REPL installation-message and
CLI-help regressions. These tests now exercise the final behavior.

## Verification

```sh
bun test js/tests/repl.test.mjs js/tests/rust-repl.test.mjs js/tests/development-tools.test.mjs --timeout 10000
CARGO_BUILD_JOBS=1 cargo test --manifest-path rust/Cargo.toml --test development --test development_cli
```

`fake-evcxr.mjs` is a finite subprocess fixture for startup configuration,
session isolation, cleanup, and signal escalation. It does not evaluate Rust.
`rust/examples/repl-input.txt` separately checks actual Rust bindings, structs, assertions,
top-level await, command macros, builders, and streams through Evcxr:

```sh
rustup component add rust-src
cargo install --locked evcxr_repl
CARGO_BUILD_JOBS=1 cargo test --manifest-path rust/Cargo.toml --test development_cli real_repl_evaluates -- --ignored --nocapture
node js/src/cli.mjs repl --language rust rust < rust/examples/repl-input.txt
```

The watcher tests use a finite child and check creation/edit/deletion restarts
and child termination. Linux CI also runs the real evaluator test with a pinned,
checksum-verified Evcxr release. Compiler jobs run sequentially.

The first real session hung on a native builder after earlier async input.
Evcxr's default static dependency linking can create separate Tokio global
process/signal state in each cell while retaining the original runtime. Startup
now creates a small dylib facade re-exporting the full crate and Tokio, and uses
`:opt 0`. This also avoids Evcxr's forced-dylib compiler wrapper, which rejects
the split standard-library metadata in Rust 1.99. The real regression fixture runs
native commands in consecutive cells, with five-second awaits to expose hangs.

## Historical CI evidence

The last failed run on the original PR head was 17592152751, created
2025-09-09T18:29:14Z for a42902c174548caf99eb68fe123e7eaebedff4b6.
GitHub returns HTTP 410 when downloading its expired logs. The retained annotation
only reports an exit code of 1; the original underlying error cannot be established
from that annotation. Fresh checks on the updated head provide current evidence.
The merge preserves the newer implementations from main rather than retaining
duplicate obsolete source trees from the original branch.
