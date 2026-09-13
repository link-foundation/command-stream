---
bump: patch
---

### Fixed

- Preserve exact stdout and stderr bytes when captured output has no trailing newline.
- Keep multiline interpolations literal across echo, printf, redirection, and nested shell programs.
