---
'command-stream': minor
---

Quote interpolated values according to the shell quoting context they land in.
A value inside quotes written by the author is now spliced in as escaped literal
text, exactly like `"$var"` in a POSIX shell, instead of being wrapped in a
second pair of quotes. This fixes the common `` $`bash -c "${cmd}"` `` form,
which previously produced `bash -c "'...'"` and failed (issue #49), while
remaining injection-safe: an interpolated value still cannot close a quote or
start a new command. Commands containing backslash escapes are routed to the
system shell so escapes are removed exactly as POSIX specifies. `raw()` and
`literal()` are unchanged, and the previous always-quote behavior is available
via `shell.quoteContext(false)`, `setQuoteContextEnabled(false)`, or
`COMMAND_STREAM_QUOTE_CONTEXT=0`.
