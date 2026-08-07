---
'command-stream': minor
---

Add `openTerminal()`, an incremental PTY session alongside `captureTerminal()`: the child stays alive with no implicit timeout, `waitFor()` reuses the existing readiness matcher (including `idleMilliseconds`), `send()` accepts the `interactions` vocabulary at any later point, and `close()`/`dispose()` return the usual frames, transcript, and asciicast. `captureTerminal()` is now implemented on top of it.
