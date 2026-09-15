---
bump: patch
---

### Added

- `Error::code()` and its `Error::exit_code()` alias report the exit status of a
  failed command, and `CommandResult::error_for_status()` turns a non-zero
  result into that error.
