---
'command-stream': patch
---

Reject terminal interactions that contain neither an action nor a wait instead
of silently ignoring them. Invalid initial interactions now fail before a PTY
is opened, and invalid `session.send()` input fails before waiting or writing.
