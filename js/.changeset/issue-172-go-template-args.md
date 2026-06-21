---
'command-stream': patch
---

Clarify and diagnose Go/Docker template arguments that contain an internal space (issue #172).

A literal template token such as `--format {{json .Config.Env}}` contains an unquoted space, so `command-stream` splits it into separate argv words — exactly as a POSIX shell (`bash`) would. This made Docker report `template parsing error: ... unclosed action`, while a space-free `{{.Id}}` worked, which was surprising and hard to diagnose.

This is shell-faithful behavior, not a bug: quoting (`'{{json .Config.Env}}'`), double-quoting, or interpolating the whole token as a single `${value}` all pass it through untouched. To make the failing case easy to spot:

- **Diagnostics**: when a built command contains an unquoted `{{ … }}` token with an internal space, `command-stream` now prints a one-line warning to stderr pointing at the gotcha (fired once per unique token, silenced via `COMMAND_STREAM_NO_TEMPLATE_WARNING=1`).
- **Docs**: a new "Go templates & `{{ }}` arguments" section in the README documents the works/breaks/workaround patterns.
- A runnable `examples/go-template-arguments.mjs` demonstrates each pattern.
