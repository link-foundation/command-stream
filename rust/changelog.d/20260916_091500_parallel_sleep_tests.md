---
bump: patch
---

### Added

- Tests covering parallel execution of sleeping commands (issue #22). Two and
  three commands started together — through the built-in `sleep`, through real
  `/bin/sleep` processes, and through `sh -c` scripts that sleep between writes
  — must all finish, keep their own output and environment, and overlap in time
  instead of running one after another.
