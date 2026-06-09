---
'command-stream': minor
---

Add chainable `.quiet()` method on `ProcessRunner` to suppress console output
(mirroring) for a single command while still capturing its result, matching the
behavior of zx's `quiet()` (issue #136).

```javascript
// Suppress console output but still capture the result
const result = await $`gh api gists/${gistId} --jq '.files'`.quiet();
```
