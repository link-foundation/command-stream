# Killing and cancelling commands

A running command can be killed, and cancelling one leaves the rest of the script running.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#child`, `ProcessRunner#kill`, `forceCleanupAll`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/cancellation.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/cancellation.mjs)

```js
// Running commands can be killed, and virtual commands are told about it
// through abortSignal / isCancelled().
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'cancellation', title: 'Killing and cancelling commands' },
  async ({ record }) => {
    const runner = $q`${process.execPath} -e ${'setTimeout(() => {}, 30_000)'}`;
    const childAvailableImmediately =
      typeof runner.child?.kill === 'function' && runner.started;
    runner.child.kill('SIGTERM');
    const killed = await runner;
    record('child handle available immediately', childAvailableImmediately);
    record('exit code after child.kill()', killed.code);

    // The handler reports back as soon as it notices the cancellation, so the
    // example does not depend on timing.
    let noticed;
    const noticedCancellation = new Promise((resolve) => {
      noticed = resolve;
    });

    register('cancellable', async ({ abortSignal, isCancelled }) => {
      for (let i = 0; i < 200; i++) {
        if (abortSignal?.aborted || isCancelled()) {
          noticed({
            aborted: abortSignal?.aborted === true,
            cancelled: isCancelled(),
          });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { stdout: '', code: 0 };
    });

    const virtualRunner = $q`cancellable`;
    virtualRunner.start();
    setTimeout(() => virtualRunner.kill(), 50);
    await virtualRunner;
    record('what the virtual command observed', await noticedCancellation);
    unregister('cancellable');
  }
);
```

### Output

Identical in Node.js and Bun:

```
# cancellation — Killing and cancelling commands
child handle available immediately: true
exit code after child.kill(): 143
what the virtual command observed: {"aborted":true,"cancelled":true}
```

## Rust

**API:** `ProcessRunner::child`, `ProcessChild::kill`, `OutputStream::kill`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn cancellation() -> ExampleResult {
    let child_command = if cfg!(windows) {
        "ping -n 31 127.0.0.1"
    } else {
        "/bin/sleep 30"
    };
    let mut runner = ProcessRunner::new(child_command, quiet_options());
    runner.start().await?;
    let (child_available, child_pid_available) = match runner.child() {
        Some(mut child) => {
            let pid_available = child.pid().is_some();
            child.kill_with("SIGTERM")?;
            (true, pid_available)
        }
        None => (false, false),
    };
    let _ = runner.run().await?;

    let mut stream = StreamingRunner::new("sleep 30").stream();
    let started = stream.wait_for_pid().await.is_some();
    stream.kill();
    let mut exit_code = 0;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            exit_code = code;
        }
    }
    Ok(vec![
        observation("child handle available after start", child_available),
        observation("child pid available", child_pid_available),
        observation("stream started", started),
        observation("cancelled stream exit is non-zero", exit_code != 0),
    ])
}
```

### Output

```
# cancellation — Rust
child handle available after start: true
child pid available: true
stream started: true
cancelled stream exit is non-zero: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — a ShellPromise has no kill method; the command runs to completion.

### [zx](https://github.com/google/zx)

```js
const p = $({ nothrow: true })`sleep 5`;
p.kill();
```

### [execa](https://github.com/sindresorhus/execa)

```js
const p = execa({ reject: false })`sleep 5`;
p.kill();
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const child = shell.exec('sleep 5', { async: true });
child.kill();
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const child = spawn('sleep', ['5']);
child.kill();
```

---

[← All features](../README.md)
