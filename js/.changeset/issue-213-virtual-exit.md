---
'command-stream': patch
---

Keep virtual `exit` statuses silent: nonzero exits have empty stderr and no
mirrored diagnostic, while `exit 0` succeeds with errexit enabled.
