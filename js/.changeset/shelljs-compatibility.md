---
'command-stream': minor
---

Add the pinned ShellJS 0.10.0 compatibility API through `$.shelljs`, the named
`shelljs` export, and the typed ESM/CommonJS `command-stream/shelljs` entry.
ShellJS is now a production dependency. Add portable native head, tail, sort and
uniq commands, preserve line endings, validate options strictly and stream file
output where possible. Include migration guidance and bounded output benchmarks.
