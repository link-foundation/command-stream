---
bump: minor
---

### Added

- `command_stream::zx`: a zx-compatible API (issue #26) with the `zx!` macro
  and `Shell` (the `$`), `ProcessPromise` (piping to processes and files,
  `nothrow`, `quiet`, `timeout`, `kill`), `ProcessOutput` (zx-style accessors
  and error messages), scoped `within`/`configure`/`cd`, the shell presets
  and the goods (`sleep`, `retry`, `exp_backoff`, `spinner`, `echo`,
  `tempdir`, `tempfile`, `which`, `glob`, `parse_argv`/`minimist`, `dotenv`,
  `transform_markdown`, `log`). Its tests port the zx unit vectors.
- `RunOptions::prefer_local` uses the same project-local executable resolver
  as the zx and Bun shells, so the default `ProcessRunner` and
  `StreamingRunner` can find local binaries.
