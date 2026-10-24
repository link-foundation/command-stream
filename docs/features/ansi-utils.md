# ANSI and control character helpers

Helpers can strip colours and control characters from captured output.

**Category:** Utilities

**Languages:** JavaScript, Rust

## JavaScript

**API:** `AnsiUtils`, `configureAnsi`, `getAnsiConfig`, `processOutput`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/ansi-utils.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/ansi-utils.mjs)

```js
// Helpers for dealing with ANSI escape sequences and control characters in
// captured output.
import {
  AnsiUtils,
  processOutput,
  configureAnsi,
  getAnsiConfig,
} from '../../src/$.mjs';
import { example } from './_harness.mjs';

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);

await example(
  { id: 'ansi-utils', title: 'ANSI and control character helpers' },
  async ({ record }) => {
    const coloured = `${ESC}[31mred${ESC}[0m and ${ESC}[32mgreen${ESC}[0m`;
    record('stripAnsi removes the colours', AnsiUtils.stripAnsi(coloured));
    record(
      'stripControlChars keeps text readable',
      AnsiUtils.stripControlChars(`beep${BELL}boop`)
    );
    record(
      'stripAll does both',
      AnsiUtils.stripAll(`${ESC}[31mred${ESC}[0m${BELL}`)
    );
    record(
      'cleanForProcessing handles buffers',
      AnsiUtils.cleanForProcessing(Buffer.from(coloured)).toString()
    );

    // The same helpers can be applied to every captured chunk through the global
    // configuration.
    const original = getAnsiConfig();
    record('default config', original);
    configureAnsi({ preserveAnsi: false });
    record('processOutput with preserveAnsi disabled', processOutput(coloured));
    configureAnsi(original);
    record('config restored', getAnsiConfig());
  }
);
```

### Output

Identical in Node.js and Bun:

```
# ansi-utils — ANSI and control character helpers
stripAnsi removes the colours: "red and green"
stripControlChars keeps text readable: "beepboop"
stripAll does both: "[31mred[0m"
cleanForProcessing handles buffers: "[31mred[0m and [32mgreen[0m"
default config: {"preserveAnsi":true,"preserveControlChars":true}
processOutput with preserveAnsi disabled: "red and green"
config restored: {"preserveAnsi":true,"preserveControlChars":true}
```

## Rust

**API:** `AnsiUtils`, `AnsiConfig`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn ansi_utils() -> ExampleResult {
    Ok(vec![observation(
        "stripped output",
        AnsiUtils::strip_all("\u{1b}[31mred\u{1b}[0m"),
    )])
}
```

### Output

```
# ansi-utils — Rust
stripped output: "red"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — no helper; strip the codes yourself.

### [zx](https://github.com/google/zx)

```js
chalk is re-exported for adding colour, but there is no helper for removing it
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa({ stripFinalNewline: true })`echo hi`; // trailing newline only, not ANSI
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — no helper; strip the codes yourself.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — no helper; strip the codes yourself.

---

[← All features](../README.md)
