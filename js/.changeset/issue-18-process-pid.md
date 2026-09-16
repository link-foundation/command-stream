---
'command-stream': minor
---

Expose the process id of a started command as `command.pid`. Issue #18 asked for
documentation on reading it, and there was nothing to document: the only handle
was `command.child.pid`, which throws once the command finishes (cleanup
releases `child`), is not populated right after `start()`, and is absent for
built-in commands with no indication of why. The id is now recorded at spawn
time, so the same value is reported from `await`, `.sync()`, `.stream()` and the
`streams` getters, and it stays readable after the command is done.

Documents the behavior in "Process ID of a Running Command" - including what the
id names (the process the shell put there, which leads its own process group,
unless `exec` mode is used to skip the shell) and why built-in commands have
none - and adds a runnable `examples/process-pid-access.mjs`.
