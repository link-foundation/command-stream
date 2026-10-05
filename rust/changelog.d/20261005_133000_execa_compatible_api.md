---
bump: minor
---

### Added

- Add `execa` module and general API exports for exact-argv async/sync commands,
  reusable defaults, binary input/output, line views, combined output,
  rejection, timeout, cancellation, bounded capture and live process streams.

### Fixed

- Write streaming stdin concurrently with stdout/stderr readers to prevent a
  full-duplex pipe deadlock; preserve native signal metadata separately from
  numeric exit codes and support replacing a streaming process environment.
