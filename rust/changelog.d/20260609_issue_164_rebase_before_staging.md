---
bump: patch
---

### Fixed

- Rebase onto the latest `origin/<branch>` **before** staging the version bump
  in the Rust release script, so concurrent releases no longer abort with
  "cannot rebase: Your index contains uncommitted changes". The release now
  syncs on a clean working tree, matching the JavaScript release script.
