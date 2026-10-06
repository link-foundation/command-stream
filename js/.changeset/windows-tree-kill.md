---
'command-stream': patch
---

Stop descendant processes on Windows when a command is killed or aborted.
Avoid delayed retries against reused Windows PIDs.
Handle asynchronous stdin EPIPE when a command exits without reading its input, and reuse error handlers across repeated writes to avoid listener warnings.
