# Synchronous execution

The same command can be run without awaiting, blocking until it finishes.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#sync`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/sync-execution.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/sync-execution.mjs)

```js
// .sync() runs a command synchronously and returns the finished result.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'sync-execution', title: 'Synchronous execution' },
  async ({ record }) => {
    const result = $q`echo synchronous`.sync();
    record('stdout', result.stdout);
    record('code', result.code);
    record(
      'result is available without await',
      typeof result.stdout === 'string'
    );

    const failed = $q`sh -c 'exit 3'`.sync();
    record('exit code of a failing command', failed.code);

    record(
      'order of execution',
      (() => {
        const order = [];
        order.push('before');
        $q`echo ignored`.sync();
        order.push('after');
        return order;
      })()
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# sync-execution — Synchronous execution
stdout: "synchronous\n"
code: 0
result is available without await: true
exit code of a failing command: 3
order of execution: ["before","after"]
```

## Rust

**API:** `run_sync`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn sync_execution() -> ExampleResult {
    let result = tokio::task::spawn_blocking(|| run_sync("echo synchronous")).await??;
    Ok(vec![observation("stdout", result.stdout)])
}
```

### Output

```
# sync-execution — Rust
stdout: "synchronous\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun.$ is always asynchronous; Bun.spawnSync is the synchronous escape hatch, and it takes an argument array rather than a command line.

### [zx](https://github.com/google/zx)

```js
const { stdout } = $.sync`echo hi`;
```

### [execa](https://github.com/sindresorhus/execa)

```js
const { stdout } = execaSync`echo hi`;
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const stdout = shell.exec('echo hi', { silent: true }).stdout; // synchronous by default
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const stdout = execFileSync('echo', ['hi'], { encoding: 'utf8' });
```

---

[← All features](../README.md)
