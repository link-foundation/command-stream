---
'command-stream': patch
---

Isolate virtual `cd` changes to one invocation, including overlapping commands and explicit `cwd` command chains, then restore the host working directory and `PWD`/`OLDPWD`.
