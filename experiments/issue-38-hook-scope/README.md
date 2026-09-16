# Issue #38: why `js/tests/test-helper.mjs` does not clean up every test file

`js/tests/test-helper.mjs` calls `beforeEach`/`afterEach` at module scope and
every test file imports it for "automatic" cleanup. ES modules are evaluated
once, so those hooks are registered in the scope of whichever test file Bun
evaluates first; every other file runs with no cleanup hooks at all.

Run it:

```
bun test experiments/issue-38-hook-scope/
```

Output (the winning file depends on the order Bun picks):

```
experiments/issue-38-hook-scope/b.test.mjs:
[b] shared beforeEach active for this file: true

experiments/issue-38-hook-scope/a.test.mjs:
[a] shared beforeEach active for this file: false
```

Consequence: global state (the `enableVirtualCommands`/`disableVirtualCommands`
flag, the virtual command registry, shell settings) leaks from one test file to
the next, and whether it leaks depends on an ordering that differs per platform.
That is what made
`error exitCode alias for error code > carries both aliases for a failing pipeline`
fail on macOS only: an earlier file left virtual commands disabled, and with them
disabled `exit 19 | cat` spawns the shell builtin `exit` as a real executable
(see `../issue-38-virtual-disabled-pipeline.mjs`), so the rejection carries
`code: "ENOENT"` instead of `19`.

`js/tests/error-exitcode-alias.test.mjs` therefore re-enables virtual commands in
its own `beforeEach` instead of trusting the shared helper.
