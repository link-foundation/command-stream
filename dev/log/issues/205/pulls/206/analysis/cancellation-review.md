# Cancellation review for PR #206

This change fixes [command-stream#205](https://github.com/link-foundation/command-stream/issues/205), which blocks [link-assistant/agent#320](https://github.com/link-assistant/agent/issues/320). Issue #320 belongs to the downstream repository; there is no command-stream issue #320. The review covers JavaScript under Bun and Node.js, plus Rust, on Windows, Linux and macOS.

## Evidence before the fix

The original JavaScript Windows heartbeat regressions failed in [run 36610911128](https://github.com/link-foundation/command-stream/actions/runs/36610911128): the descendant's heartbeat continued to grow after both abort and `kill()`.

The previously reported failed check was [language parity run 36611604593](https://github.com/link-foundation/command-stream/actions/runs/36611604593), for commit `d71483b`. JavaScript source had changed without an equivalent Rust fix. The later `parity-exempt` label hid that missing implementation; this revision fixes Rust and removes the exemption.

Commit `91dda00271ae493d238c5d0b7228c85c54abdc31` added regressions before changing the Rust implementation. [Rust run 37475608185](https://github.com/link-foundation/command-stream/actions/runs/37475608185), created on 2026-10-06 at 14:02:14 UTC, confirmed failures on all three operating systems. In the downloaded combined log:

- Lines 4177–4195: Linux `stream_kill_escalates_after_the_parent_exits` failed with `worker survived after its shell exited`; heartbeat lengths were 50 and 30.
- Lines 5740–5765: the same regression failed on macOS; heartbeat lengths were 20 and 10.
- Lines 7145–7185: Windows streaming kill, zero-grace cancellation and stream drop all left the descendant writing. `process_runner_kill_stops_descendants` also timed out while waiting for completion.

The log is preserved as [rust-reproduction-37475608185.log.gz](./rust-reproduction-37475608185.log.gz). Line numbers refer to the uncompressed log.

The isolated `node-windows-kill.mjs` tests also failed before the follow-up JavaScript fix: successful `taskkill` scheduled another numeric-PID kill after the grace period, and failed `taskkill` attempted the requested signal instead of forceful fallback termination.

The full local Bun suite exposed an asynchronous stdin `EPIPE`. A minimal `Writable` whose write callback reports `EPIPE` reproduced the unhandled error under both Node and Bun. A second regression reproduced 20 error listeners after 20 writes and a `MaxListenersExceededWarning`.

## Root causes and changes

- Windows requires tree termination before stopping the parent. Both implementations now use hidden, quiet `taskkill /PID <pid> /T /F`, with direct-child termination as the fallback. JavaScript avoids delayed retries against a potentially reused Windows PID. Trace diagnostics remain disabled by default.
- Rust streaming cancellation previously stopped escalation as soon as `child.wait()` completed. A shell could exit while descendants ignored the first signal. The runner now retains the unreaped leader through the POSIX grace period, then signals the whole group with `SIGKILL`. Zero grace and explicit `SIGKILL` skip the delay.
- Node-style stdin errors arrive asynchronously and bypass a synchronous `write()` catch. The shared stream utility installs its existing error handler before writing, and reuses the default handler for subsequent writes.

Windows has no POSIX signal-handler grace period. If `taskkill` is unavailable or fails, the fallback can terminate only the direct child. [Microsoft's taskkill documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) defines `/T` as descendant termination and `/F` as forced termination.

## Regression coverage and release preparation

JavaScript heartbeat tests cover shell and exact-argv commands, abort, timeout, `kill()`, explicit `SIGKILL`, zero grace, ignored termination signals, and leaving an async iterator. Tests wait for a positive heartbeat before cancelling and verify it stops afterwards, preventing a false pass when startup never created a descendant. Fixtures have finite ten-second lifetimes and explicit cleanup.

Rust tests cover process-runner kill, streaming kill, zero grace, stream drop and POSIX escalation after the shell exits. The standalone Rust heartbeat fixture is retained under `experiments/issue-205/`.

The existing Bun and Rust matrices cover Windows, Linux and macOS. New jobs also exercise Node.js 20, 22 and 24 on Windows and macOS; the existing Node.js matrix covers Linux. Both normal and instant JavaScript releases require these jobs to succeed. The workflow regression test verifies the new release dependency and condition.

Patch changesets for JavaScript and a Rust changelog fragment prepare both packages for their next automatic release. Platform behavior is documented in each package README.

## Local verification

- Rust: 826 passing tests, including doctests; all features enabled with compiler and documentation warnings denied. Formatting, Clippy on all targets/features and generated API documentation passed.
- Node.js: 563 passing tests, two skipped, covering the core regressions and the zx/Execa compatibility suites.
- Executable feature parity: all 29 features passed in JavaScript (Node and Bun) and Rust.
- The full Bun suite passed, as did JavaScript lint, formatting, types and duplication checks. The full suite requires `jq`; the first local run exposed its absence, so subsequent runs include the official jq binary on `PATH`.

Final CI results are linked in the pull request description and must match its latest commit before it is marked ready.
