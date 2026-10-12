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
