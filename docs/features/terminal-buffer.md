# Track virtual terminal frames

Independent terminal emulators expose visible text, colors and changed-frame subscriptions.

**Category:** Streaming

**Languages:** JavaScript, Rust

## JavaScript

**API:** `TerminalBuffer`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/terminal-buffer.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/terminal-buffer.mjs)

```js
import { TerminalBuffer } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'terminal-buffer', title: 'Track virtual terminal frames' },
  async ({ record }) => {
    const terminal = new TerminalBuffer({ rows: 2, cols: 20 });
    try {
      await terminal.write('old\r\x1b[2K\x1b[31mred\x1b[0m');
      await terminal.flush();
      record('visible text', terminal.text().trimEnd());
      record('colored', terminal.text({ color: true }).includes('\x1b['));
    } finally {
      terminal.dispose();
    }
  }
);
```

### Output

Identical in Node.js and Bun:

```
# terminal-buffer — Track virtual terminal frames
visible text: "red"
colored: true
```

## Rust

**API:** `terminal::TerminalBuffer`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn terminal_buffer() -> ExampleResult {
    let mut terminal = command_stream::terminal::TerminalBuffer::new(2, 20);
    terminal.write(b"old\r\x1b[2K\x1b[31mred\x1b[0m");
    Ok(vec![
        observation("visible text", terminal.text(false).trim_end()),
        observation("colored", terminal.text(true).contains('\x1b')),
    ])
}
```

### Output

```
# terminal-buffer — Rust
visible text: "red"
colored: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No virtual terminal emulator or frame API; combine with xterm/headless.

### [zx](https://github.com/google/zx)

Not supported — No virtual terminal emulator or frame API; combine with xterm/headless.

### [execa](https://github.com/sindresorhus/execa)

Not supported — No virtual terminal emulator or frame API; combine with xterm/headless.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No virtual terminal emulator or frame API; combine with xterm/headless.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — No virtual terminal emulator or frame API; combine with xterm/headless.

---

[← All features](../README.md)
