---
bump: patch
---

### Fixed

- The changelog fragment check now accepts only `.md` files directly in
  `rust/changelog.d/`, the only ones the release reads, and rejects a `bump:`
  value other than `patch`, `minor` or `major` instead of releasing it as the
  default patch bump.
