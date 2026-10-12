# Issue 9: virtual terminal changes

The current main branch already provides terminal emulation, live PTY input,
asciicast recording and styled SVG/GIF exports. The remaining issue was that
applications could not subscribe to compact live changes, buffer frame iteration
silently replaced intermediate notifications, and continuous output depended on
idle-frame scheduling.

## Reproduction

`js/tests/terminal-changes.test.mjs` was written before implementation. Initially
five tests failed: no buffer change events, no change iterator, no live session
subscriptions and no PTY dimension validation. The change iterator now preserves
ordered deltas, reports overflow and drains on close. Colors, clears, cursor-only
updates, wide text, combining marks, scrolling and alternate screens reconstruct
the same snapshots as the emulator.

The transport probe exposed a further failure: tmux exited with
`open terminal failed: terminal does not support clear` when the parent environment
had `TERM=dumb`. The new TERM regression test reproduced `dumb` instead of
`xterm-256color`. Virtual PTYs now default to `xterm-256color` independently of the
parent, while explicit environment overrides remain supported.

## Finite integration probes

```sh
node --test js/tests/terminal-changes.test.mjs js/tests/node-terminal-artifacts.mjs
node experiments/issue-9/check-transports.mjs
node experiments/issue-9/check-ssh.mjs
```

The first command includes real interactive Linux `top`: frame subscriptions,
resize, `q` input, and a separate three-frame animation exported to SVG/GIF.
Shell/multiplexer probes require `tmux` and `screen`. They verify the same fixture
through direct Node, sh, bash, tmux and screen: input, green cells, initial 37-column
dimensions and resize to 43 columns. tmux's default status bar reserves one row;
the test accounts for that application's layout.

The SSH probe requires `openssh-server`. It creates disposable identity/host keys
and a server bound to a random loopback port, running as the current user. It tests
real SSH PTY allocation, input, color and remote resize propagation, then stops the
server and deletes its files. Each application has a five-second deadline, PTY
sessions have six-second deadlines and the isolated SSH server has a fifteen-second
deadline. CI installs the required tools and runs both probes on Linux.

Rust regression tests replay ANSI deltas into another vt100 parser and compare
text, cursor and formatted state, including alternate screens and Unicode. Session
tests cover live subscriptions, input and recording disabled. Its synchronous
driver must be polled when receivers are consumed; it does not create a background
session event loop.

## Export evidence

```sh
node js/examples/terminal-change-stream.mjs
node experiments/issue-9/render-preview.mjs
```

The example emits three frames and three changes (`ready`, `running`, `complete`).
After the initial full screen, each delta replaces only the status row. Exports
and the rendered PNG are committed under
`js/docs/screenshots/terminal-changes/`. The PNG is rasterized directly from the
exported SVG using its embedded font.

Full animation means every published emulator state at parsed PTY write/repaint
boundaries, not an application-independent semantic frame boundary: the OS can
combine or split writes. Raw asciicast preserves all output/input/resize events
when recording is enabled. Queue overflow is explicit so a receiver can take a
fresh snapshot. Dimension and scrollback bounds prevent unbounded allocations.
The JavaScript renderer supplies faithful styled SVG/GIF; Rust's native artifact
path supplies asciicast and text SVG. See
[`VIRTUAL_TERMINAL.md`](../../js/docs/VIRTUAL_TERMINAL.md) for API usage and limits.

## CI investigation

The first pushed head was `cf8505f` (2026-10-12 05:02 UTC). Linux/macOS terminal
tests and parity checks passed, but
[dependency freshness run 38206214879](https://github.com/link-foundation/command-stream/actions/runs/38206214879)
failed. Its downloaded log at `ci-logs/dependencies-38206214879.log` reports
`Updating unicode-ident v1.0.26 -> v1.0.27` at line 712 and
`rust/Cargo.toml has pending lockfile updates` at line 731. No direct dependency
declaration was stale. Both main and benchmark Cargo lockfiles were refreshed
using `cargo update`; the only change is this compatible patch dependency and
its checksum. The full Rust suite and Clippy were rerun against the refreshed
lockfile before pushing it.

[JavaScript run 38206214894](https://github.com/link-foundation/command-stream/actions/runs/38206214894)
also exposed two new fixture failures on Windows Bun. The downloaded log at
`ci-logs/js-38206214894.log` reports `Error: File not found` at lines 18826 and
18873: ConPTY cannot launch the bare `node` fixture name used by the new tests.
The existing portable PTY tests use the running executable's absolute
`process.execPath`. The new tests now follow that pattern and compare the
normalized transcript for TERM assertions, accounting for ConPTY's terminal
control output. These tests still run on Windows rather than being skipped.

[JavaScript run 38207102785](https://github.com/link-foundation/command-stream/actions/runs/38207102785)
then exposed a PTY host race on macOS Bun. The downloaded job log at
`ci-logs/js-macos-114673144059.log` reports `PTY host exited with code 0` instead
of the child's expected exit code 3 at lines 6775–6776. The host's process `exit`
event can precede delivery of its buffered stdout terminal-status message.
A deterministic mock reproduces that ordering and initially delivered a false
host failure followed by the real terminal status. The bridge now waits for
`close`, after pipes drain, before reporting a missing terminal status. The new
regression runs on Node and Bun; the existing missing-handshake test remains.

The following run (`29f3ba9`) passed macOS, but Windows Bun's session-exit test
timed out at line 4587 of `ci-logs/js-windows-114675469744.log`. The run was
cancelled after eight minutes to retrieve partial logs: it stopped progressing
after that timeout. Waiting exclusively for the child-process `close` event was
insufficient on this path. The bridge now also observes process exit plus stdout
and stderr `end` events. A second deterministic regression reproduces a missing
`close` event and preserves the final stderr diagnostic. Lifecycle tracing stays
off by default and is enabled with `COMMAND_STREAM_TRACE=true`. CI runs the
focused terminal suites with tracing before the full suite, with a two-minute
step deadline so any lifecycle regression produces diagnostics promptly.

That focused step in
[run 38209214639](https://github.com/link-foundation/command-stream/actions/runs/38209214639/job/114679661430)
identified the remaining Windows sequence: stderr drained (line 840) and the host
exited (line 841), but stdout never ended. The session-exit test then timed out
(lines 846–847) in `ci-logs/js-windows-114679661430.log`. Two further deterministic
regressions reproduce this missing EOF, including a delayed buffered child status.
After host exit the bridge now drains buffered messages until 100 ms of silence,
with a one-second upper bound, and destroys the pipes if EOF is missing. Normal
EOF/close completes immediately. This preserves late child status and prevents an
already dead host's open pipe from keeping the session or test process alive.
