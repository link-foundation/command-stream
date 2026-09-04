---
bump: patch
---

### Fixed

- `bytes` bumped to 1.12.1, clearing RUSTSEC-2026-0007 (integer overflow in `BytesMut::reserve`). The advisory went unnoticed because nothing in the pipeline audited the lockfile; `cargo audit` now runs on every push, pull request and weekly.
- `ls` no longer computes a file type character it never used, and iterates directory entries with `.flatten()` instead of matching on each `Result`.

### Changed

- The Rust pipeline denies warnings: `RUSTFLAGS`/`RUSTDOCFLAGS` are `-Dwarnings`, clippy runs with `-- -D warnings`, and `cargo doc --no-deps` gates the rustdoc-only lints. Clippy previously printed 15 warnings and exited 0. `Cargo.toml` forbids `unsafe_code` and warns on `clippy::all`.
- `CommandContext::cwd` is covered by tests: `pwd` honours it, and `ls` resolves both a relative path and its default argument against it.
