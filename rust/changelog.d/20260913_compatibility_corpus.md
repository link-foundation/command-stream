---
bump: patch
---

### Added

- Added a pinned 14-project Rust competitor compatibility corpus, complete
  per-test disposition manifest, reproducible discovery snapshot, and
  missing-feature audit.

### Fixed

- Propagated exact-executable spawn errors from `StreamingRunner::collect()` instead of returning a false success.
- Preserved quoted command strings passed through `cmd.exe /c`, including
  executable paths that require Windows shell quoting.
