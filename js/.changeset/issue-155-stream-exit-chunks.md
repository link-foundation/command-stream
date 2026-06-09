---
'command-stream': minor
---

Fix `stream()` async iterator to yield exit chunks and never hang on open pipes (issue #155)

- `stream()` now yields a final `{ type: 'exit', code }` chunk when the process
  exits, so the documented `chunk.type === 'exit'` handling is no longer dead
  code. Consumers that touch `chunk.data` must guard on `chunk.type` first.
- Both `stream()` and awaiting a command no longer hang forever when the process
  has exited but a grandchild keeps the stdio pipes open (e.g.
  `sh -c 'long-task & echo done'`). The command resolves as soon as the process
  exits; remaining buffered output is drained within a short grace period before
  the lingering reads are aborted.
- The grace period is configurable via the `exitPumpGrace` option (milliseconds,
  default `100`). For ordinary commands the pumps drain immediately, so the grace
  adds no latency — it only bounds the wait in the grandchild-holds-pipe case.
- A long-running command can be stopped from inside the `stream()` loop, either by
  calling `kill()` (the loop then ends with a terminating `exit` chunk) or by
  `break`ing out of the loop (which kills the process as the iterator unwinds).
