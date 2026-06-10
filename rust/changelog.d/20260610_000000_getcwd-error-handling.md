---
bump: patch
---

### Fixed
- Handle `getcwd()`/`current_dir()` failures during command execution (issue #44). When the inherited working directory has been deleted or becomes inaccessible, the child process is now spawned from a valid fallback directory (`HOME`, `USERPROFILE`, the temp dir, then `/`) instead of failing at the OS level. Applies to both `ProcessRunner` and `Pipeline`.
