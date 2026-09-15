---
bump: minor
---

### Added

- `tee` built-in command, mirroring the JavaScript implementation and GNU
  coreutils: `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short
  flags, `--` as an option terminator, and a bare `-` treated as a file named
  `-`. A write failure is reported on stderr and sets exit code 1 while the
  remaining files are still written.
- Tests covering the `StdinOption` invariant that keeps stdio modes and input
  content in separate variants, so a mode can never be read as command input.
