---
bump: patch
---

### Fixed

- Redirections and expansions are no longer swallowed by virtual commands
  (#46). `ProcessRunner` dispatched to a virtual command before checking
  whether the command needed a real shell, and arguments came from splitting on
  whitespace, so `echo hello > out.txt` printed `hello > out.txt` instead of
  writing the file and `git push origin main 2>&1` reported success while
  nothing had been pushed. `needs_real_shell` now recognises `>` and `<` in all
  their forms, and the real-shell check runs before virtual dispatch, matching
  `/bin/sh`.
