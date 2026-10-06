---
'command-stream': patch
---

Finish streams promptly when the supplied AbortSignal is already aborted, yielding exactly one exit chunk with the stored result code. Also finish iteration when the runner completed before stream listeners were attached.
