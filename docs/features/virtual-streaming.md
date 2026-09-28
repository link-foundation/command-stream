# Streaming commands

A streaming handler publishes output incrementally like a real process.

**Category:** Your own commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `register`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/virtual-streaming.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/virtual-streaming.mjs)

```js
// A handler written as an async generator streams its output chunk by chunk,
// so consumers see data before the command has finished.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'virtual-streaming', title: 'Streaming commands' },
  async ({ record }) => {
    register('countdown', async function* ({ args }) {
      for (let i = Number(args[0] ?? 3); i > 0; i--) {
        yield `${i}\n`;
      }
      yield 'liftoff\n';
    });

    const chunks = [];
    for await (const chunk of $({ mirror: false })`countdown 3`.stream()) {
      if (chunk.type === 'exit') {
        continue;
      }
      chunks.push(chunk.data.toString());
    }
    record('chunks received one by one', chunks);
    record(
      'same command awaited as a whole',
      (await $({ mirror: false })`countdown 2`).stdout
    );

    // Streaming commands compose with the rest of a pipeline.
    record(
      'piped into a built-in',
      (await $({ mirror: false })`countdown 2 | cat`).stdout
    );

    unregister('countdown');
  }
);
```

### Output

Identical in Node.js and Bun:

```
# virtual-streaming — Streaming commands
chunks received one by one: ["3\n","2\n","1\n","liftoff\n"]
same command awaited as a whole: "2\n1\nliftoff\n"
piped into a built-in: "2\n1\nliftoff\n"
```

## Rust

**API:** `CommandContext::output_tx`, `StreamChunk`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn virtual_streaming() -> ExampleResult {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
    let mut context = CommandContext::new(Vec::new());
    context.output_tx = Some(sender);
    let result = streaming_handler(context).await;
    let mut chunks = Vec::new();
    while let Ok(chunk) = receiver.try_recv() {
        if let command_stream::StreamChunk::Stdout(text) = chunk {
            chunks.push(text);
        }
    }
    Ok(vec![
        observation("chunks", chunks),
        observation("collected output", result.stdout),
    ])
}
```

### Output

```
# virtual-streaming — Rust
chunks: ["one\n","two\n"]
collected output: "one\ntwo\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — no handler API.

### [zx](https://github.com/google/zx)

Not supported — no handler API.

### [execa](https://github.com/sindresorhus/execa)

Not supported — no handler API.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — a plugin returns its output as one value when it is done.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — no handler API.

---

[← All features](../README.md)
