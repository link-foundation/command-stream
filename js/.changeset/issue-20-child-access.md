---
'command-stream': minor
---

Expose `command.child` synchronously so a lazy command can be stopped with
`command.child.kill('SIGTERM')` before startup has crossed its first asynchronous
boundary. The stable pending handle follows the native Node.js or Bun child once
it is spawned, also supports cancelling in-process built-ins, and is released
from `command.child` after cleanup.
