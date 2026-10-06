# Issue #208: signal termination reported as success

Run the original finite POSIX reproduction under either runtime:

```sh
node experiments/issue-208/signal-exit-code.mjs
bun experiments/issue-208/signal-exit-code.mjs
```

Each spawned shell sends a signal only to itself; no memory or stack stress is
needed. The script compares awaited and synchronous ProcessRunner results with
Node's `child_process` APIs and asserts the SIGKILL result.

Before the fix, awaited shell file/args commands returned `code: 0` for both
SIGTERM and SIGKILL and exposed no `signal` field. Synchronous Node execution
could also return 0. Some sync probes instead returned 1 with `spawnSync /bin/sh
EPIPE`: the `stdin: 'ignore'` mode was being sent as input bytes to the quickly
exiting shell.

Bun's native API has another distinction: its `exited` promise returns 143 or
137, but its synchronous result has `exitCode: null`. Both native subprocess
objects expose the signal name as `signalCode`. Node's exit/close events and
sync `signal` field supply that name directly.

The fix carries `{ code, signal }` through exit observation, converts actual
signal termination with the platform's `128 + signal number` convention, and
preserves the signal on results, exit events, and stream exit chunks. Ordinary
exits expose `signal: null`, including `exit 137`. Cancellation continues to
report the requested stop signal. Sync stdio mode keywords are no longer input.

The initial 43-case regression suite failed every case under Bun before the
fix. The final suite adds cases for running stream cancellation, explicit
stdin's Node spawn path, and replaying a completed command's signal.

The Node 20/24 runs additionally exposed an unhandled async stdin `EPIPE` when a
child died during the write. The explicit-input path now installs the same
traced error handler already used by the runner's other stdin pumps.

Completed-stream replay also forwards the stored signal. After merging the
latest default branch, the replay regression failed with `signal: undefined`
instead of `SIGTERM`. The existing pre-aborted stream tests now verify the
signal metadata while preserving their no-spawn and completion assertions.

Bun 1.4.2 on macOS reported a real SIGUSR1 as `SIGPWR` in CI, so nine signal
regressions returned 1 instead of 158. This matches
[Bun's upstream issue #35296](https://github.com/oven-sh/bun/issues/35296).
Async native statuses recover the OS signal number. For sync results and Bun's
Node-compatible child processes, ambiguous names use a cached, finite capability
probe so releases with the corrected platform table retain their names.
Mocked Darwin tests cover the old and corrected tables; actual SIGUSR1 and
SIGUSR2 tests exercise all execution paths in the macOS CI job.

Shell file/args sync execution uses Bun's Node-compatible `spawnSync`, rather
than its native sync API. The same normalization applies there. The isolated
mock below reproduces CI's `1`/`140` statuses for SIGUSR1/SIGUSR2 on any host;
it failed before fixing this path and now verifies `158`/`159` and an ordinary
exit. It changes runtime/platform state only inside its own process and sends
no real signals:

```sh
node experiments/issue-208/bun-darwin-node-sync.mjs
bun experiments/issue-208/bun-darwin-node-sync.mjs
```

Run it under both runtimes:

```sh
bun test js/tests/process-runner-signal-exit.test.mjs --timeout 10000
node --test js/tests/process-runner-signal-exit.test.mjs
```

The suite tests shell file/args, shell command strings, and exact-argv execution
for SIGTERM, SIGKILL, SIGINT, SIGUSR1, and SIGUSR2; async/sync/stream status; signal metadata
and events; normal exits; virtual commands; launch failure; cancellation;
errexit; and sync stdin modes. POSIX-only cases skip on Windows. The suite also
runs in the Node 20/22/24 CI matrix.

This is a JavaScript runtime defect. Rust's streaming runner already maps
signal exits to `128 + signal number` and exposes `exit_signal()`; its basic
runner already returns a nonzero status (`-1`) when no numeric code exists.
Neither Rust path turns a signal death into success. The PR uses the documented
`parity-exempt` label rather than making unrelated Rust API changes; executable
feature parity remains checked.
