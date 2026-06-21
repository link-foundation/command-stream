---
bump: patch
---

### Added
- Diagnostic warning for Go/Docker template arguments with an internal space
  (issue #172). When a built command contains an unquoted `{{ … }}` token that
  contains a space (e.g. `--format {{json .Config.Env}}`), the shell — and
  command-stream, which mirrors shell word-splitting — splits it into multiple
  argv words. `command-stream` now prints a one-line warning to stderr pointing
  at the gotcha (fired once per unique token, silenced via
  `COMMAND_STREAM_NO_TEMPLATE_WARNING`). Quote the token (`'{{json .Config.Env}}'`)
  or interpolate it as a single value to pass it through untouched.
