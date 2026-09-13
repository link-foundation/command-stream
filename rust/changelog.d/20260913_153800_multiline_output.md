---
bump: patch
---

### Fixed

- Preserve stdout and stderr text without inventing a trailing newline.
- Keep multiline interpolations literal across echo, printf, redirection, and nested shell programs.
