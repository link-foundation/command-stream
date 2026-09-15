---
bump: patch
---

### Fixed

- Guarantee that successful stderr-only CLI output remains separately captured,
  including pull request URLs, while `2>&1` retains normal shell merge behavior.
