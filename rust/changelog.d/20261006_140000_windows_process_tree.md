---
bump: patch
---

### Fixed

- Stop descendant processes on Windows when a process runner is killed or a streaming command is cancelled or dropped.
- Escalate POSIX streaming cancellation to stop descendants that ignore the requested signal after their parent exits.
