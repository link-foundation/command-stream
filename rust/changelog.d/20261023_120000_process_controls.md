---
bump: minor
---

### Added

- `RunOptions::timeout` and `StreamingRunner::timeout` stop a command with its kill signal once the limit passes; `timed_out()` reports it (#227).
- `RunOptions::env_remove`, `StreamingRunner::env_remove`/`env_remove_all` and `TerminalCaptureOptions::env_remove`/`env_clear` remove variables from the child's environment (#229).
- `StreamingRunner::stdin_pipe` with `OutputStream::write_stdin`/`close_stdin` keeps stdin open while output streams, and `ProcessRunner::from_argv` runs an exact argv that works with `StdinOption::Pipe` (#230).
- `TerminalCaptureOptions::artifacts` selects the artifact files to write, plus a new `recording.gif` artifact, `aspect_ratio` and `on_trace` (#231).
- `StreamingRunner::detach` and `ProcessRunner::spawn_detached` start a fire-and-forget command and return its pid (#232).

### Changed

- crates.io releases publish through trusted publishing (OIDC) and fall back to the `CARGO_REGISTRY_TOKEN` secret (#226).
