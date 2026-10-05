# Async iteration over output

A command is an async iterable of chunks, so output can be handled as it arrives.

**Category:** Streaming

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#[Symbol.asyncIterator]`, `ProcessRunner#stream`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/async-iteration.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/async-iteration.mjs)

```js
// A command is an async iterable of output chunks, so output can be processed
// while the command is still running.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'async-iteration', title: 'Async iteration over output' },
  async ({ record }) => {
    const lines = [];
    for await (const chunk of $q`seq 1 5`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      lines.push({ type: chunk.type, data: chunk.data.toString() });
    }
    record('chunk types', [...new Set(lines.map((l) => l.type))]);
    record('collected output', lines.map((l) => l.data).join(''));

    // stdout and stderr are tagged, so both can be consumed from one loop.
    const tagged = [];
    for await (const chunk of $q`sh -c 'echo to-stdout; echo to-stderr >&2'`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      tagged.push([chunk.type, chunk.data.toString().trim()]);
    }
    record('tagged chunks', tagged.sort());

    // Leaving the loop early terminates the command.
    let seen = 0;
    for await (const _chunk of $q`seq 1 1000`.stream()) {
      seen++;
      break;
    }
    record('iteration can stop early', seen === 1);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# async-iteration — Async iteration over output
chunk types: ["stdout"]
collected output: "1\n2\n3\n4\n5\n"
tagged chunks: [["stderr","to-stderr"],["stdout","to-stdout"]]
iteration can stop early: true
```

## Rust

**API:** `StreamingRunner`, `OutputStream::next`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn async_iteration() -> ExampleResult {
    let mut stream = StreamingRunner::new("printf 'one\\ntwo\\n'").stream();
    let mut stdout = Vec::new();
    let mut exit_code = None;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => stdout.extend(data),
            OutputChunk::Stderr(_) => {}
            OutputChunk::Exit(code) => exit_code = Some(code),
        }
    }
    Ok(vec![
        observation("collected chunks", String::from_utf8(stdout)?),
        observation("exit code", exit_code),
    ])
}
```

### Output

```
# async-iteration — Rust
collected chunks: "one\ntwo\n"
exit code: 0
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
for await (const line of $`printf 'a\nb\n'`.lines()) {
  /* line by line only */
}
```

### [zx](https://github.com/google/zx)

```js
for await (const line of $`printf 'a\nb\n'`) {
  /* lines */
}
```

### [execa](https://github.com/sindresorhus/execa)

```js
for await (const line of execa`printf 'a\nb\n'`) {
  /* lines */
}
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — output is only delivered as a whole string, or through the raw child process in async mode.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
for await (const chunk of spawn('printf', ['a\nb\n']).stdout) {
  /* Buffers */
}
```

---

[← All features](../README.md)
