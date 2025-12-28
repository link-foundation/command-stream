---
'command-stream': patch
---

Add Windows shell detection support

- Added Windows-specific shell detection (Git Bash, PowerShell, cmd.exe)
- Use 'where' command on Windows instead of 'which' for PATH lookups
- Fallback to cmd.exe on Windows when no Unix-compatible shell is found
- Updated timing expectations in tests for slower Windows shell spawning
- Created case study documentation for Windows CI failures (Issue #144)
