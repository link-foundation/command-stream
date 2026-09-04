---
'command-stream': patch
---

Restore the host process working directory and `PWD`/`OLDPWD` after each `cd` invocation while preserving directory changes inside command chains.
