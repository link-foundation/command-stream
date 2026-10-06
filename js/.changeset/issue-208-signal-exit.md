---
'command-stream': patch
---

Report signal-terminated processes with shell-compatible nonzero exit statuses
in async and sync execution. Expose the signal name (or null for ordinary exits)
on results, stream exit chunks, and exit events, with matching TypeScript types.
Treat synchronous stdin mode keywords as modes rather than input bytes.
Handle stdin EPIPE events when a child dies during an asynchronous input write.
Normalize macOS signal names reported with the Linux table by older Bun versions.
