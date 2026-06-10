---
'command-stream': patch
---

Handle `getcwd() failed` errors gracefully during subshell execution (issue #44).

`process.cwd()` throws `getcwd() failed: No such file or directory` when the current working directory has been deleted or becomes inaccessible (common in CI/CD with temporary directories). Subshell execution and directory restoration now degrade gracefully instead of crashing:

- capturing the working directory before a subshell no longer throws when `getcwd()` fails
- directory restoration falls back to a safe location (`HOME`, then `/`) when the original directory is gone
- simple commands fall back to the inherited `cwd` when `getcwd()` is unavailable
- spawning a child process no longer fails with `posix_spawn ENOENT` when the inherited working directory has been deleted; the process is launched from a valid fallback directory (`HOME`, `USERPROFILE`, the temp dir, then `/`) instead
