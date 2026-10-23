---
'command-stream': minor
---

Add process controls requested in issues #227-#232. The `timeout` option stops a command with its kill signal and reports `result.timedOut`; aborting a pipeline with a virtual stage now resolves with the signal exit code instead of rejecting. Command strings run in a non-login shell by default, so profile files no longer print into captured output or override the PATH from `env`; `loginShell: true` restores the old behaviour. An `env` value of `undefined` removes that variable from the child. Terminal capture takes an `artifacts` selection and skips renderers for files that are not selected. `spawnDetached()`, `runner.spawnDetached()` and `$({ detached: true })` start a fire-and-forget command in its own session and resolve with its `pid`. The execa compatibility layer now uses execa 10.1.1; 10.2.0 is held back until sindresorhus/execa#1265 is fixed, because its declarations fail to type-check with `exactOptionalPropertyTypes`.
