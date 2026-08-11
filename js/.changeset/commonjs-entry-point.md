---
'command-stream': minor
---

Add a CommonJS entry point (`src/$.cjs`) published under the `require` export condition, so `require('command-stream')` returns the callable `$` with every named export attached and CommonJS hosts can use the synchronous `ProcessRunner.sync()` API without `await import()`. Both entry points load one shared module instance, so virtual commands, shell settings, and cleanup state stay in sync regardless of how the package was loaded.
