# Time out a command

The `timeout` option stops a command with its kill signal once the limit passes; the result reports `timedOut`.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `timeout`, `timedOut`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/timeouts.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/timeouts.mjs)

```js
// The timeout option stops a command that runs too long.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'timeouts', title: 'Time out a command' },
  async ({ record }) => {
    // Stopped with the kill signal (SIGTERM) once 200ms have passed.
    const slow = await $({ mirror: false, timeout: 200 })`sleep 5`;
    record('exit code', slow.code);
    record('timed out', slow.timedOut);

    const quick = await $({ mirror: false, timeout: 5000 })`echo in time`;
    record('finished in time', quick.stdout);
    record('quick command timed out', quick.timedOut);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# timeouts — Time out a command
exit code: 143
timed out: true
finished in time: "in time\n"
quick command timed out: false
```

## Rust

**API:** `RunOptions::timeout`, `StreamingRunner::timeout`, `ProcessRunner::timed_out`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn timeouts() -> ExampleResult {
    // Stopped with the kill signal (SIGTERM) once 200ms have passed.
    let mut slow = ProcessRunner::new(
        "sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(200)),
            ..quiet_options()
        },
    );
    let result = slow.run().await?;

    let mut quick = ProcessRunner::new(
        "echo in time",
        RunOptions {
            timeout: Some(Duration::from_secs(5)),
            ..quiet_options()
        },
    );
    let in_time = quick.run().await?;
    Ok(vec![
        observation("exit code", result.code),
        observation("timed out", slow.timed_out()),
        observation("finished in time", in_time.stdout),
        observation("quick command timed out", quick.timed_out()),
    ])
}
```

### Output

```
# timeouts — Rust
exit code: 143
timed out: true
finished in time: "in time\n"
quick command timed out: false
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun.$ has no timeout; Bun.spawn accepts { timeout }.

### [zx](https://github.com/google/zx)

```js
await $({ timeout: '200ms', nothrow: true })`sleep 5`; // signal SIGTERM
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa({ timeout: 200 })`sleep 5`; // throws, error.timedOut
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.exec('sleep 5', { timeout: 200 }); // code only
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('sleep', ['5'], { timeout: 200 }, callback);
```

---

[← All features](../README.md)
