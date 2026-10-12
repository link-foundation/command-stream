# Stream processing and analytics

Command output can be processed as it arrives in JavaScript (Node and Bun) and Rust. See the [executable feature examples](features/stream-processing.md) for captured results and the finite native log monitors in [JavaScript](../js/examples/stream-analytics-demo.mjs) and [Rust](../rust/examples/stream_monitoring.rs).

## APIs in both languages

| Operation                | JavaScript                                                            | Rust                                                       |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Command stdout lines     | `command.stream().lines()`                                            | `StreamingRunner::stream().lines()`                        |
| Transform                | `.map(asyncFn)`                                                       | `.map(fn)` / `.map_async(asyncFn)`                         |
| Filter                   | `.filter(asyncPredicate)`                                             | `.filter(predicate)`                                       |
| Accumulate               | `await .reduce(fn, initial)`                                          | `.reduce(initial, fn).await`                               |
| Process each value       | `await .forEach(asyncFn)`                                             | `.for_each(asyncFn).await`                                 |
| Split                    | `.split(predicate, { highWaterMark })` returns `[matched, unmatched]` | `.split(predicate)` returns `(matched, unmatched)`         |
| Merge                    | `merge(...streams)` / `$.merge(...streams)`                           | `left.merge(right)` (chain for more inputs)                |
| Size batches             | `.batch(size)`                                                        | `.batch(size)`                                             |
| Size or deadline batches | `.batch(size, milliseconds)`                                          | `.batch_with_timeout(size, Duration)`                      |
| Sliding windows          | `.window(size)` / `.slidingWindow(size)`                              | `.window(size)` / `.sliding_window(size)`                  |
| Online statistics        | `await .analyze({ errorRate, responseTime, onUpdate })`               | `.analyze(error_predicate, response_sample, update).await` |

JavaScript raw command iteration retains stdout/stderr/exit chunks. Fluent command operators automatically frame stdout lines; `.lines()` is explicit when passing commands to `merge`. Rust command processing starts with `.lines()`. Map/filter produce ordinary values, batching/windows produce arrays or vectors, and reduce/analyze return final results. `errorRate` / `error_rate` is a fraction, with a separate error count. Response statistics ignore non-finite samples. Update callbacks receive cumulative statistics while the source is still running.

```js
import { $ } from 'command-stream';

await $({ capture: false, mirror: false })`docker logs -f app`
  .stream()
  .filter((line) => line.includes('ERROR'))
  .map((line) => ({ at: Date.now(), message: line }))
  .batch(10, 500)
  .forEach(async (batch) => {
    await sendAlerts(batch);
  });
```

A batch deadline starts when its first item arrives. It flushes a partial batch even if no further input arrives, and does not restart on every item. A full batch flushes immediately; source completion flushes any final partial batch. Empty batches are never emitted. JavaScript deadlines must be finite, positive and at most 2,147,483,647 milliseconds; Rust accepts a positive `Duration` whose deadline fits Tokio's clock. Delivery still waits for the consumer to request the next batch or for output-channel capacity.

## Backpressure and cleanup

JavaScript map/filter operators pull only as requested and await async callbacks. Timed batching keeps at most one pending input read, and merge keeps one per input. Split queues default to 32 values per branch; consume both branches concurrently or explicitly return the unused branch. Rust stages use channels bounded at 32 values. Dropping a Rust consumer stops its producer; returning a JavaScript command pipeline cancels its running command. Slow consumers consequently slow upstream production rather than accumulating all records.

Use `capture: false` for commands whose full output should not be retained. Capturing results, `toArray()` / `collect()`, and result-returning virtual handlers intentionally retain data. A single unterminated line or a large record can still require substantial memory; the limits above count queued records, not a maximum record size. Native pipelines and generator handlers support bounded processing, while handlers receiving complete stdin strings retain that input.

## Comparison with alternatives

These alternatives already support streaming. The distinction is the ready-made command-level combination of line transforms, bounded splitting/merging, timed batches, windows and online error/latency/throughput metrics.

| Alternative                                                                                                                                                                 | Existing streaming capabilities                                                                                     | Additional composition needed for this pipeline                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Node streams](https://nodejs.org/api/stream.html)                                                                                                                          | Async iteration, map/filter/reduce, transforms, high-water marks and backpressure                                   | Line framing, split/merge, deadline batches, windows and analytics       |
| [Execa](https://github.com/sindresorhus/execa/blob/main/docs/transform.md)                                                                                                  | Line iteration, generator transforms/filtering, Node/Web stream interop                                             | Windows, timed batches, split/merge routing and cumulative analytics     |
| [zx](https://google.github.io/zx/process-promise)                                                                                                                           | Line iteration, readable stdout/stderr and piping through Node transforms                                           | Operator composition, windows, batching and analytics                    |
| [Bun Shell](https://bun.com/docs/runtime/shell)                                                                                                                             | `.lines()`, pipes and redirection; [Bun.spawn](https://bun.com/docs/runtime/child-process) also exposes Web streams | Operator composition, split/merge, batching, windows and analytics       |
| [ShellJS](https://github.com/shelljs/shelljs#execcommand--options--callback)                                                                                                | Async `exec` returns a child process whose stdout can be consumed; synchronous commands return completed output     | Line framing and the processing operators                                |
| [Rust futures](https://docs.rs/futures/latest/futures/stream/trait.StreamExt.html) / [Tokio streams](https://docs.rs/tokio-stream/latest/tokio_stream/trait.StreamExt.html) | Generic asynchronous map/filter/fold, merge and size/deadline chunks                                                | Adapting process output, cancellation, routing and application analytics |

The absence of a named convenience method does not imply an alternative cannot implement it. This is an API comparison, not a speed ranking. [`compare-streams.mjs`](../experiments/issue-31/compare-streams.mjs) runs a finite transform/filter case against command-stream, Node Readable, installed Execa, zx, async ShellJS and (in Bun) Bun Shell. The observed numeric results agree. Versions are pinned by the JavaScript lockfile. Bun Shell's line iterator also yields a final empty string for this fixture; the comparison explicitly skips empty lines. The Rust [comparison test](../rust/tests/stream_processing.rs) checks the same transform/filter/deadline-batch result against Tokio Stream's `chunks_timeout`.

For streaming versus buffered memory use, run the existing [finite memory experiment](../experiments/issue-224/stream-memory.mjs) in separate processes:

```sh
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs stream
node --max-old-space-size=128 experiments/issue-224/stream-memory.mjs buffer
```

Both modes process 100,000 records (25.6 MB). The experiment records elapsed time and RSS growth; measurements vary by runtime and host. It compares capture strategies in command-stream, without implying that competitors cannot use bounded streams.
