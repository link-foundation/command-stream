---
'command-stream': patch
---

Make node-pty optional so core process execution installs on Linux without a
native build toolchain and works with lifecycle scripts disabled or optional
dependencies omitted. Report recovery instructions when PTY support is used
without an available native binding, and test packed production installs in
clean Node slim containers.
