---
'command-stream': patch
---

Expose the exit status of a failing command under both `error.code` and
`error.exitCode`, so handlers written for Node.js `child_process` and for
Execa, zx, nano-spawn or the Bun shell work unchanged. The attached
`error.result` carries both names as well, and a command that could not be
launched at all reports its shell-compatible status (127, 126) through
`error.exitCode` while `error.code` keeps the POSIX errno.
