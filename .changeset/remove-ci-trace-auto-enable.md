---
'command-stream': patch
---

Fix trace logs interfering with output when CI=true

- Removed automatic trace log enabling when CI environment variable is set
- Trace logs no longer pollute stderr in CI/CD environments (GitHub Actions, GitLab CI, etc.)
- Added COMMAND_STREAM_TRACE environment variable for explicit trace control
- COMMAND_STREAM_TRACE=true explicitly enables tracing
- COMMAND_STREAM_TRACE=false explicitly disables tracing (overrides COMMAND_STREAM_VERBOSE)
- COMMAND_STREAM_VERBOSE=true continues to work as before
- JSON parsing works reliably in CI environments

Fixes #135
