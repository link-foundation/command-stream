# Virtual terminal buffers, frames and changes

`TerminalBuffer` parses terminal output with xterm/headless. `openTerminal`
connects that emulator to a real PTY, so the application has terminal input,
terminal output, terminal dimensions and resize notifications at the same time.
Ordinary `$` pipe execution remains available for programs that expect pipes.

```js
import { TerminalBuffer } from 'command-stream';

const buffer = new TerminalBuffer({ cols: 120, rows: 40, frameInterval: 0 });
buffer.on('change', (change) => console.log(change.updates));
buffer.on('input', (response) => remotePty.write(response));
await buffer.write(remoteOutput);
console.log(buffer.text());
console.log(buffer.text({ color: true }));
buffer.dispose();
```

Supply your transport's `remotePty` and `remoteOutput` in this example. Byte
chunks can split UTF-8 and escape sequences; the emulator maintains parser state.
Alternate screens, wide characters, combining marks, cursor movement, erasure,
scrolling and cell colors are interpreted as terminal operations.

## Live applications

```js
import { openTerminal } from 'command-stream';

const session = await openTerminal({
  file: 'top',
  cols: 100,
  rows: 30,
  frameMode: 'writes',
  recording: false,
});
const unsubscribe = session.onChange((change) => sendToViewer(change));
try {
  await session.send({ resize: { cols: 120, rows: 40 } });
  await session.send({ key: 'q' });
  await session.finished();
} finally {
  unsubscribe();
  await session.dispose();
}
```

`sendToViewer` is your consumer. `onFrame` receives full snapshots; `onChange`
receives deltas. Both return an unsubscribe function. `snapshot()` and `text()`
read current visible state; `text({ color: true })` preserves styled cells,
including background-colored spaces. Terminal query responses return to PTY
input automatically.

Use `session.frameStream()` or `session.changes()` for async iteration. Independent
buffers expose `frames()` and `changes()`. These streams emit only changed states,
preserve notification order, drain queued events on close and release listeners.
They finish automatically on child exit or buffer disposal. A stream subscribes
on its first `next()` call. Take a snapshot immediately after that call to seed
a viewer joining an existing session. Subscriptions do not replay earlier events.

The default queue capacity is 64. Pass `{ capacity, signal }` to bound a stream
or cancel a pending read. Overflow rejects the stream: subscribe again and take
a new snapshot. Sequence numbers also identify missed deltas. Slow consumers
must resynchronize rather than applying changes after a gap.

## Applying a delta

A `TerminalChange` includes dimensions, cursor, alternate-screen state and a
monotonically increasing `sequence`. `updates` contains only changed rows, with
their row index, text and styled cells. Replace those rows in your local screen.
`history` is a splice for `snapshot().lines`: apply
`lines.splice(history.start, history.deleteCount, ...history.lines)`.

If `reset` is true, clear screen and history first, adopt the new dimensions,
then apply every row in `updates`. Resizing and switching alternate screens
produce resets. Cursor-only updates have an empty `updates` array. Empty writes
and identical redraws emit no change. These are row deltas, so changing one cell
sends its row rather than the entire screen.

## Recording and animation

Buffers coalesce updates over `frameInterval` milliseconds (default 16), similar
to animation-frame scheduling. Set it to zero to publish after each parsed write.
For PTY sessions, `frameMode: 'settled'` is the default and coalesces output until
idle; `'writes'` retains each parsed output write and explicit full-screen repaint
boundary. There is no application-independent definition of a completed TUI
frame: operating systems may combine or split PTY writes. The asciicast records
all raw output, input and resize events for replay, even when rendered frames
are coalesced.

Set `artifactDirectory` to export `session.cast`, frame JSON, a transcript,
`snapshot.svg`, animated `recording.svg` and `recording.gif`. Existing rendering
preserves cell colors, geometry, text attributes and frame timing. Run
`node js/examples/terminal-change-stream.mjs` (or Bun) for an interactive example
and generated SVG/GIF evidence.

Recording defaults to enabled and retains history for exports. For long-lived
streaming sessions set `recording: false`: keep only the newest frame, no cast
events, and a rolling last 1,000,000 output characters. Readiness matching uses
that rolling output. Raw output remains available through `session.process.onData`.
The emulator still retains its configured scrollback; rendering a scrollback
transcript or exporting the entire session requires recording to be enabled.

## Shells and transports

Use the same API with `file: 'bash', args: ['--noprofile', '--norc']`, `file: 'sh'`,
`file: 'ssh', args: ['-tt', 'host']`, `file: 'tmux', args: ['new-session']`, or
`file: 'screen'`. SSH needs a remote PTY (`-tt`) for terminal input and resize
propagation. Multiplexers may add status bars, reserve rows or use their own TERM;
configure those applications when an identical layout is required. The PTY
reports the selected dimensions through the OS and initial COLUMNS/LINES values.
Its default TERM is `xterm-256color`, independent of the parent terminal; set
`env.TERM` explicitly to request another terminal type.
Resize updates the PTY and emulator together; programs must handle the OS resize
notification to redraw.

Dimensions support positive integers up to 65,535 per axis and 1,000,000 visible
cells. Independent-buffer scrollback also has a 1,000,000-cell limit. These finite
limits avoid pathological allocations; buffers are not fixed to 80 by 24.
Terminal protocols and application behavior still matter: graphics protocols,
platform-specific escape extensions and applications that ignore resize events
cannot be made identical by a text emulator. Node native PTY support must be
installed; the existing optional-dependency diagnostics explain missing support.

## Rust

`terminal::TerminalBuffer::subscribe()` emits full `BufferFrame` snapshots and
`subscribe_changes()` emits `BufferChange` values. Deltas contain replayable ANSI
bytes, dimensions, cursor, alternate-screen state and sequence numbers. On a
reset resize the receiving terminal before processing `ansi`. On
`tokio::sync::broadcast::error::RecvError::Lagged`, obtain a new snapshot before
processing further changes. `take_input()` drains terminal query responses for
forwarding to a remote application's input.

`TerminalSession` exposes `snapshot()`, `text(color)`, `subscribe()` and
`subscribe_changes()`. Its existing synchronous driver advances notifications
through `poll()`, `wait_for()`, `send()` and `finish()`; drive it in a worker thread
when consuming receivers asynchronously. `TerminalCaptureOptions` supports
`frames_on_write` and `recording`. Without recording it keeps one frame, no cast
events, and the last 1,000,000 output bytes at UTF-8 boundaries. Rust exports
asciicast and SVG; use the JavaScript renderer for styled SVG/GIF exports.
