---
bump: minor
---

### Added

- `$fy` virtual command: a shell-to-JavaScript translator implemented as a
  rule-based translation over a link-foundation/meta-language links network
  (formalize, then substitute). It mirrors the JavaScript implementation
  byte-for-byte, which `rust/tests/fy.rs` and `js/tests/fy-tool.test.mjs` both
  assert against the shared golden fixture in `fixtures/fy/`.
