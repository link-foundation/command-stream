---
bump: patch
---

### Added

- Added a pinned Rust competitor compatibility corpus and missing-feature audit.

### Fixed

- Propagated exact-executable spawn errors from `StreamingRunner::collect()` instead of returning a false success.
