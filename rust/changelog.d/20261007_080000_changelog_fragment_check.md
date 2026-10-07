---
bump: patch
---

### Fixed

- The changelog fragment check now accepts only `.md` files directly in
  `rust/changelog.d/`, the only ones the release reads, and rejects a `bump:`
  value other than `patch`, `minor` or `major` instead of releasing it as the
  default patch bump.
- A fragment added while another is removed in the same pull request is no
  longer missed by git's rename detection, an existing fragment moved
  unchanged still does not count as a new one, and code moved out of the
  source tree still counts as a code change.
