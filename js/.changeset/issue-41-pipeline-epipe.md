---
'command-stream': patch
---

Ignore `EPIPE` when a pipeline stage closes the stdin of a process that has
already exited. Closing (or writing to) that pipe is a normal race in a
pipeline - a shell ignores it - but the streaming pipeline let the rejection
escape as an unhandled error, which could fail an otherwise successful
command. This matches the Rust implementation, which already discards those
write and shutdown errors.
