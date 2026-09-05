---
bump: patch
---

### Fixed

- Perform POSIX quote removal per argument so interpolated values containing
  spaces (e.g. `gh issue list --label "help wanted"`) reach virtual commands as
  a single argument with quotes stripped, matching `/bin/sh` behavior (#48).
- Fix a tokenizer infinite loop on a lone `&` (as in `2>&1` or backgrounding),
  which the word scanner previously neither consumed nor treated as an operator.
