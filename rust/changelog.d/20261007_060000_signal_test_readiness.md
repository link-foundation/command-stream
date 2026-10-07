---
bump: patch
---

### Changed

- Make the signal handling tests wait until each child has installed its trap
  before signalling it, and poll for handler markers and heartbeats with a
  bounded wait instead of fixed sleeps, matching the JavaScript suite.
