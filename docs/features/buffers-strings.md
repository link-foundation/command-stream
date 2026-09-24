# Buffer and string interfaces

Output is available as a string and as raw bytes, without running the command twice.

**Category:** Reading output

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#text`, `ProcessRunner#buffers`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/buffers-strings.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/buffers-strings.mjs)

```js
// .buffers and .strings expose the output as Buffers or as decoded strings.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'buffers-strings', title: 'Buffer and string interfaces' },
  async ({ record }) => {
    const asBuffer = await $q`echo buffered`.buffers.stdout;
    record('buffers.stdout is a Buffer', Buffer.isBuffer(asBuffer));
    record('buffers.stdout content', asBuffer.toString());

    const asString = await $q`echo stringified`.strings.stdout;
    record('strings.stdout', asString);

    const stderrBuffer = await $q`sh -c 'echo problem >&2'`.buffers.stderr;
    record('buffers.stderr content', stderrBuffer.toString());

    // Binary-safe: bytes survive the round trip unchanged.
    const bytes = await $q`printf 'a\\tb'`.buffers.stdout;
    record('raw bytes', Array.from(bytes));
  }
);
```

### Output

Identical in Node.js and Bun:

```
# buffers-strings — Buffer and string interfaces
buffers.stdout is a Buffer: true
buffers.stdout content: "buffered\n"
strings.stdout: "stringified\n"
buffers.stderr content: "problem\n"
raw bytes: [97,9,98]
```

## Rust

**API:** `CommandResult::stdout`, `OutputChunk`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn buffers_strings() -> ExampleResult {
    let result = quiet("printf bytes").await?;
    Ok(vec![
        observation("string", &result.stdout),
        observation("bytes", result.stdout.as_bytes()),
    ])
}
```

### Output

```
# buffers-strings — Rust
string: "bytes"
bytes: [98,121,116,101,115]
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
const result = await $`echo hi`.quiet();
result.stdout; // Buffer
await $`echo hi`.text(); // string, but runs the command again
```

### [zx](https://github.com/google/zx)

```js
const p = await $`echo hi`;
p.stdout; // string
Buffer.from(p.stdout); // bytes by conversion
```

### [execa](https://github.com/sindresorhus/execa)

```js
const { stdout } = await execa({ encoding: 'buffer' })`echo hi`; // choose one up front
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — output is decoded to a string; raw bytes are not available.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const { stdout } = await promisify(execFile)('echo', ['hi'], {
  encoding: 'buffer',
});
```

---

[← All features](../README.md)
