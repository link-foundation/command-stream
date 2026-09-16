---
'command-stream': minor
---

Deliver signals gracefully when stopping a running command. `kill()` used to
send the requested signal and `SIGKILL` in the same tick, so a child that
trapped `SIGTERM` never got to run its handler even though the reported exit
code claimed it had. The signal is now delivered to the whole process group,
followed by a grace period, and only then by `SIGKILL`. The new `killGrace`
option controls that window (default `100` ms; `0` escalates immediately), and
`killSignal` sets the default signal for `kill()`, `break`, and `AbortSignal`.

Documents the behavior in "Sending Signals to a Running Command" with the
`128 + signal` exit-code table, and adds a runnable
`examples/signals-graceful-shutdown.mjs`.
