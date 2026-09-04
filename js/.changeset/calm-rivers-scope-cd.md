---
'command-stream': patch
---

Track virtual `cd` changes in invocation-local cwd and environment state, including overlapping commands, subshells, and explicit `cwd` command chains, without mutating the host working directory or `PWD`/`OLDPWD`.
