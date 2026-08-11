---
'command-stream': patch
---

Support `{ mode: 'shell', file, args }` ProcessRunner specifications for commands that require the platform shell, including Windows `.cmd` shims. Async and sync execution now delegate this form to Node's shell-enabled spawn APIs while preserving the existing streaming, capture, stdin, cwd, environment, and result behavior.
