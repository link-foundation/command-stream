---
bump: minor
---

### Added

- Added live stdin writes with `ProcessRunner::write_stdin` and `ProcessRunner::close_stdin`.
- Added executable Rust counterparts for every feature in the generated language-parity guide.

### Fixed

- Pipelines now use the last stage's status by default and the rightmost failure with `pipefail`.
- Shell sequence operators are executed with shell-compatible behavior.
- `VirtualCommandRegistry::with_builtins` now returns the complete built-in catalog.
