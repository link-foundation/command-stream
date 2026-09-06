---
'command-stream': minor
---

Interpolate every value as exactly one literal argument, like `"$var"` in a
POSIX shell. `quote()` no longer treats a value that starts and ends with a
matching quote as ready-made shell syntax: those quote characters are part of
the value, so a path such as `/My Documents/report.txt` (or a pre-quoted one)
reaches the command intact (issue #41). This matches `sh`, Bun's `$`, zx and
execa, and it removes two defects of the old heuristic - `quote('"it\'s"')`
emitted the unterminated string `'"it\'s"'`, and a value like
`"' ; touch /tmp/pwned ; '"` was spliced in as shell syntax and executed. The
previous behavior is available for balanced values only, via
`shell.preQuotedPassthrough(true)`, `setPreQuotedPassthroughEnabled(true)`, or
`COMMAND_STREAM_PREQUOTED_PASSTHROUGH=1`.

Also ignore `EPIPE` when a pipeline stage closes the stdin of a process that
has already exited. Closing (or writing to) that pipe is a normal race in a
pipeline - a shell ignores it - but the streaming pipeline let the rejection
escape as an unhandled error, which could fail an otherwise successful
command. This matches the Rust implementation, which already discards those
write and shutdown errors.
