---
bump: minor
---

### Added
- `open_terminal` returns a `TerminalSession` that keeps a PTY open with no implicit timeout, so input that only becomes available later can be sent with `send`, awaited with `wait_for` (the same readiness matcher as `interactions`, including the idle wait), and finalized with `close`/`finish`.

### Changed
- `TerminalCaptureOptions::timeout` is now `Option<Duration>` (`Some(30s)` by default, `None` for sessions), and `capture_terminal` is implemented on top of `TerminalSession`.
