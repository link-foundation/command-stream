---
'command-stream': patch
---

Handle asynchronous stdin EPIPE when a command exits without reading its input, and reuse error handlers across repeated writes to avoid listener warnings.
