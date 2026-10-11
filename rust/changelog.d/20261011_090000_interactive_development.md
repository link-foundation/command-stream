---
bump: minor
---

### Added

- Native Rust `repl` and `dev` commands, Evcxr startup with the complete public crate and Tokio, and configurable local crate loading.
- `dev`, `DevOptions`, `DevEvent`, `DevController`, `start_repl`, `ReplOptions`, and `RustRepl` APIs with debounced file creation/edit/deletion detection, build-output exclusions, and child shutdown before restarts.
- Real Rust evaluator integration coverage in Linux CI.
