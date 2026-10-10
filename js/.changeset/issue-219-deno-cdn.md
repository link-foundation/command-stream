---
'command-stream': patch
---

Fix core imports and command execution from esm.sh on Deno by resolving the
ShellJS glob guard through CDN imports when filesystem resolution is unavailable
and deferring the filesystem loader for zx and Execa until those APIs are used.
Preserve ShellJS dependency isolation and glob protection in local installations.
