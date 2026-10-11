# Process streams incrementally

Pull-driven operators provide batching, windows, split, merge, backpressure and online statistics.

**Category:** Streaming

**Languages:** JavaScript, Rust

## JavaScript

**API:** `stream`, `StreamPipeline`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/stream-processing.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/stream-processing.mjs)

```js
import { stream } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'stream-processing', title: 'Process streams incrementally' },
  async ({ record }) => {
    record(
      'batches',
      await stream([1, 2, 3, 4, 5])
        .filter((value) => value % 2 === 1)
        .map((value) => value * 2)
        .batch(2)
        .toArray()
    );
    const stats = await stream([10, 30]).analyze({
      errorRate: (value) => value > 20,
      responseTime: (value) => value,
    });
    record('error rate', stats.errorRate);
    record('mean response time', stats.responseTime.mean);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# stream-processing — Process streams incrementally
batches: [[2,6],[10]]
error rate: 0.5
mean response time: 20
```

## Rust

**API:** `DataStream`, `StreamStats`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn stream_processing() -> ExampleResult {
    let batches = DataStream::from_values([1, 2, 3, 4, 5])
        .filter(|value| value % 2 == 1)
        .map(|value| value * 2)
        .batch(2)
        .collect()
        .await;
    let stats = DataStream::from_values([10, 30])
        .analyze(|value| *value > 20, |value| Some(f64::from(*value)), |_| {})
        .await;
    Ok(vec![
        observation("batches", batches),
        observation("error rate", stats.error_rate),
        observation("mean response time", stats.response_mean),
    ])
}
```

### Output

```
# stream-processing — Rust
batches: [[2,6],[10]]
error rate: 0.5
mean response time: 20.0
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No built-in window, split, merge, or command analytics operators; use runtime stream primitives.

### [zx](https://github.com/google/zx)

Not supported — No built-in window, split, merge, or command analytics operators; use runtime stream primitives.

### [execa](https://github.com/sindresorhus/execa)

Not supported — No built-in window, split, merge, or command analytics operators; use runtime stream primitives.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No built-in window, split, merge, or command analytics operators; use runtime stream primitives.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
for await (const chunk of spawn('node', ['server.mjs']).stdout) {
  await consume(chunk);
}
```

---

[← All features](../README.md)
