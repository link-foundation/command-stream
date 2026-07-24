---
'command-stream': patch
---

Preserve the current terminal frame before a later full-screen repaint,
including when its control sequence is split across PTY output chunks.
