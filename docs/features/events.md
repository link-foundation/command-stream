# Event-driven output

Event APIs report output and lifecycle signals as work progresses.

**Category:** Streaming

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#on`, `ProcessRunner#off`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/events.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/events.mjs)

```js
// Commands are EventEmitters: 'stdout', 'stderr', 'data' and 'end'.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'events', title: 'EventEmitter interface' },
  async ({ record }) => {
    const events = [];

    await new Promise((resolve, reject) => {
      $q`sh -c 'echo out; echo err >&2'`
        .on('stdout', (data) => events.push(['stdout', data.toString().trim()]))
        .on('stderr', (data) => events.push(['stderr', data.toString().trim()]))
        .on('end', (result) => {
          events.push(['end', result.code]);
          resolve();
        })
        .on('error', reject)
        .start();
    });

    record(
      'events (sorted: stdout/stderr order is up to the OS)',
      events.sort()
    );

    // The 'data' event receives both streams with a type tag.
    const tagged = [];
    await new Promise((resolve) => {
      $q`echo tagged`
        .on('data', (chunk) =>
          tagged.push([chunk.type, chunk.data.toString().trim()])
        )
        .on('end', () => resolve())
        .start();
    });
    record('data events', tagged);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# events — EventEmitter interface
events (sorted: stdout/stderr order is up to the OS): [["end",0],["stderr","err"],["stdout","out"]]
data events: [["stdout","tagged"]]
```

## Rust

**API:** `StreamEmitter`, `EventType`, `EventData`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn events() -> ExampleResult {
    let emitter = StreamEmitter::new();
    let count = Arc::new(AtomicUsize::new(0));
    let listener_count = Arc::clone(&count);
    emitter
        .on(EventType::Stdout, move |_| {
            listener_count.fetch_add(1, Ordering::SeqCst);
        })
        .await;
    emitter
        .emit(EventType::Stdout, EventData::String("hello".to_string()))
        .await;
    Ok(vec![observation(
        "stdout events",
        count.load(Ordering::SeqCst),
    )])
}
```

### Output

```
# events — Rust
stdout events: 1
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — a ShellPromise is not an EventEmitter and exposes no streams.

### [zx](https://github.com/google/zx)

```js
$`echo hi`.stdout.on('data', (chunk) => {
  /* Node stream events */
});
```

### [execa](https://github.com/sindresorhus/execa)

```js
execa`echo hi`.stdout.on('data', (chunk) => {
  /* Node stream events */
});
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.exec('echo hi', { async: true }).stdout.on('data', (chunk) => {});
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
spawn('echo', ['hi']).stdout.on('data', (chunk) => {});
```

---

[← All features](../README.md)
