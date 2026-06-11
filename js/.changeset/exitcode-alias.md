---
'command-stream': minor
---

Add `exitCode` as an alias for the `code` property on all command result objects (issue #36). Code written against the `exitCode` convention (e.g. `child_process` / `execa`) now works without changes, while the existing `code` property remains fully supported.
