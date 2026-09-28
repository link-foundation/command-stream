---
bump: patch
---

### Fixed

- Release script now also bumps the crate version in `rust/benchmarks/Cargo.lock`, so the benchmark workflow's `--locked` checks keep passing after a Rust release.
