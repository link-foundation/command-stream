# Await a command

Awaiting a command returns an object with stdout, stderr and the exit code.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/await-result.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/await-result.mjs)

```js
// Awaiting a command returns a result object with stdout, stderr and the exit code.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'await-result', title: 'Await a command' },
  async ({ record }) => {
    const result = await $q`echo "hello world"`;
    record('stdout', result.stdout);
    record('stderr', result.stderr);
    record('code', result.code);

    const system = await $q`sh -c 'printf out; printf err >&2'`;
    record('stdout of a system binary', system.stdout);
    record('stderr of a system binary', system.stderr);

    record('interpolated value', (await $q`echo ${'a value'}`).stdout);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# await-result — Await a command
stdout: "hello world\n"
stderr: ""
code: 0
stdout of a system binary: "out"
stderr of a system binary: "err"
interpolated value: "a value\n"
```

## Rust

**API:** `run`, `CommandResult`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn await_result() -> ExampleResult {
    let result = quiet("echo hello").await?;
    Ok(vec![
        observation("stdout", result.stdout),
        observation("stderr", result.stderr),
        observation("exit code", result.code),
    ])
}
```

### Output

```
# await-result — Rust
stdout: "hello\n"
stderr: ""
exit code: 0
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
const { stdout, stderr, exitCode } = await $`echo hi`.quiet();
// stdout and stderr are Buffers, not strings
```

### [zx](https://github.com/google/zx)

```js
const { stdout, stderr, exitCode } = await $`echo hi`;
```

### [execa](https://github.com/sindresorhus/execa)

```js
const { stdout, stderr, exitCode } = await execa`echo hi`;
// no shell is involved, so `echo hi` is the binary `echo` with one argument
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const result = shell.exec('echo hi', { silent: true });
// result.stdout, result.stderr, result.code
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const { stdout, stderr } = await promisify(execFile)('echo', ['hi']);
```

---

[← All features](../README.md)
