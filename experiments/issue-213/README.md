# Virtual exit status reproduction

Run from the repository root:

```sh
node experiments/issue-213/virtual-exit.mjs 2>stderr.txt
bun experiments/issue-213/virtual-exit.mjs 2>stderr.txt
node --test js/tests/virtual-exit.test.mjs
bun test js/tests/virtual-exit.test.mjs --timeout 10000
```

The probe prints nine observations. Each has empty stderr, and `stderr.txt`
remains empty. Nonzero statuses reject with errexit enabled; zero and omitted
statuses resolve. Without errexit, nonzero statuses resolve as before.

Before the fix, six of the eight regression tests failed under Node and Bun.
The probe mirrored `Command failed with exit code N` for caught failures,
including the successful status 0 under errexit. The real child process was
silent. The regression suite also checks exit events, status aliases, stopping
the sequence after `exit 3` under errexit, and retaining diagnostics from
unexpected virtual-handler errors.

The fix keeps the existing nonzero handler rejection with explicit empty
stderr and allows successful exits to return normally. Keeping that rejection
also avoids manufacturing stderr when capture is disabled. Argument parsing
and sequence behavior without errexit retain their existing behavior; making
virtual `exit` terminate every sequence like a POSIX shell is a separate change.

Rust already returns the requested status with empty stderr, so the source fix
is JavaScript-specific. A patch changeset prepares the next npm release, and the
regression suite runs in the existing Bun and Node CI matrices.
