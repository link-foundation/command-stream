---
'command-stream': patch
---

Expose the exit status of a failing command under both `error.code` and
`error.exitCode`, so handlers written for Node.js `child_process` and for
Execa, zx, nano-spawn or the Bun shell work unchanged. The attached
`error.result` carries both names as well.
