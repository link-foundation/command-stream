# Process streams incrementally

Pull-driven operators provide size/deadline batching, sliding windows, split, merge, backpressure and online statistics.

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
    record('timed batches', await stream([1, 2, 3]).batch(2, 500).toArray());
    record(
      'sliding windows',
      await stream([1, 2, 3]).slidingWindow(2).toArray()
    );
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
timed batches: [[1,2],[3]]
sliding windows: [[1,2],[2,3]]
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
    let timed = DataStream::from_values([1, 2, 3])
        .batch_with_timeout(2, std::time::Duration::from_millis(500))
        .collect()
        .await;
    let windows = DataStream::from_values([1, 2, 3])
        .sliding_window(2)
        .collect()
        .await;
    Ok(vec![
        observation("batches", batches),
        observation("timed batches", timed),
        observation("sliding windows", windows),
        observation("error rate", stats.error_rate),
        observation("mean response time", stats.response_mean),
    ])
}
```

### Output

```
# stream-processing — Rust
batches: [[2,6],[10]]
timed batches: [[1,2],[3]]
sliding windows: [[1,2],[2,3]]
error rate: 0.5
mean response time: 20.0
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
for await (const line of $`node server.mjs`.lines()) {
  if (line.includes('ERROR')) await consume(line);
} // compose windows, split/merge, batching and analytics separately
```

### [zx](https://github.com/google/zx)

```js
for await (const line of $`node server.mjs`) {
  if (line.includes('ERROR')) await consume(line);
} // Node transforms are also supported; compose batching/analytics separately
```

### [execa](https://github.com/sindresorhus/execa)

```js
const transform = function* (line) {
  if (line.includes('ERROR')) yield line.toUpperCase();
};
await execa({ stdout: transform })`node server.mjs`; // compose batching/analytics separately
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const child = exec('node server.mjs', { async: true });
for await (const line of createInterface({ input: child.stdout })) {
  await consume(line);
} // compose filtering, windows, batching and analytics separately
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const processed = spawn('node', ['server.mjs'])
  .stdout.map(transform)
  .filter(predicate); // frame lines and compose batching/analytics separately
```

---

[← All features](../README.md)
