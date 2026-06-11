---
'command-stream': patch
---

Fix CI false positives caused by the test-isolation reset racing in-flight commands (issue #170).

Two related defects made tests intermittently report a synthetic `SIGTERM` result (exit code 143, stderr `Process killed with SIGTERM`) and emit a `MaxListenersExceeded` warning, most visibly on Windows/Bun:

- `cleanupActiveRunners()` (invoked by `resetGlobalState()` between tests) could force-kill a command that user code was still awaiting, replacing its real exit code with a synthetic SIGTERM result. The reaper now skips runners that are being awaited and have not finished, so the genuine exit code is preserved. A new `_awaited` flag is set synchronously when user code starts consuming a runner (`await`/`then`/`catch`/`finally`/`stream`).
- `monitorParentStreams()` attached a `close` listener to `process.stdout`/`process.stderr` on every `ProcessRunner` construction but never removed them on reset, so they accumulated until Node/Bun emitted a `MaxListenersExceeded` warning. The listeners are now tracked and removed in `resetGlobalState()`/`resetParentStreamMonitoring()`.
