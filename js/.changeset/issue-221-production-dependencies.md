---
'command-stream': patch
---

Remove ShellJS and its type package from consumer dependencies. Preserve the
ShellJS 0.10 command API with bundled compatibility source and declarations,
using command-stream's dependency-free glob engine and current Execa runtime.
Production installs no longer resolve fast-glob, micromatch or braces through
ShellJS, and imports no longer resolve ShellJS paths with createRequire.
Expose bundled plugin registration at command-stream/shelljs/plugin and preserve
ESM loading on Node 22.0 without requiring the newer require(esm) bridge.
