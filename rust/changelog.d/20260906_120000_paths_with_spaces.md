---
bump: minor
---

### Fixed

- Interpolate every value as exactly one literal argument, like `"$var"` in a
  POSIX shell. `quote` no longer treats a value that starts and ends with a
  matching quote as ready-made shell syntax, so paths with spaces (and
  pre-quoted paths) reach the command intact (issue #41). This also fixes
  `quote("\"it's\"")`, which used to emit the unterminated string `'"it's"'`,
  and closes an injection where a value like `"' ; touch /tmp/pwned ; '"` was
  spliced into the command and executed.

### Added

- `is_pre_quoted_passthrough_enabled` and `COMMAND_STREAM_PREQUOTED_PASSTHROUGH=1`
  restore the previous pre-quoted passthrough for balanced values only.
