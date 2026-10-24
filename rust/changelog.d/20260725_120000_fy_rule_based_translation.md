---
bump: minor
---

### Added

- `$fy` virtual command: a shell-to-JavaScript translator implemented as a
  rule-based translation over a link-foundation/meta-language links network
  (formalize, then substitute). It mirrors the JavaScript implementation
  byte-for-byte, which `rust/tests/fy.rs` and `js/tests/fy-tool.test.mjs` both
  assert against the shared golden fixture in `fixtures/fy/`.

- Source migration for zx, Execa, ShellJS, cross-spawn and Bun shell APIs,
  with shared fixtures, native/virtual CLI options, stdin, exclusive output,
  lossless command-stream + use-m shell modules, and structural compilation.
- Upgrade meta-language to 1.0.0 and use its public dynamic-arity syntax API.
