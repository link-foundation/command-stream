---
'command-stream': patch
---

Fix CI false positives where a global teardown preempted an in-flight, awaited command (issue #170).

Three related defects made tests intermittently report a `SIGTERM` result (exit code 143) and emit a `MaxListenersExceeded` warning, most visibly on Windows/Bun. All are now keyed on a new `_awaited` flag, set synchronously when user code starts consuming a runner (`await`/`then`/`catch`/`finally`/`stream`):

- `_handleParentStreamClosure()` killed any active runner when a parent `stdout`/`stderr` `close` event fired. On Windows/Bun the parent `WriteStream` can emit a spurious `close` (the same instability behind the `MaxListenersExceeded` warning), which preempted the awaited command and replaced its real exit code with `143`. It now skips runners that are being awaited, since the `await` is the authoritative consumer. This was the actual CI trigger.
- `cleanupActiveRunners()` (invoked by `resetGlobalState()` between tests) could force-kill a command that user code was still awaiting, replacing its real exit code with a synthetic SIGTERM result. The reaper now skips awaited, unfinished runners.
- `monitorParentStreams()` attached a `close` listener to `process.stdout`/`process.stderr` on every `ProcessRunner` construction but never removed them on reset, so they accumulated until Node/Bun emitted a `MaxListenersExceeded` warning. The listeners are now tracked and removed in `resetGlobalState()`/`resetParentStreamMonitoring()`.
