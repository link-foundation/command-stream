---
'command-stream': patch
---

Keep Deno HTTP compatibility checks running during a confirmed esm.sh GitHub
builder storage outage on pull requests. Retain strict release gating and print
recovery instructions on main; other CDN and execution failures remain fatal.
