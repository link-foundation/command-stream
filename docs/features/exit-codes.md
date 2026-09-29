# Exit codes and errors

A non-zero exit code is reported on the result instead of thrown, unless errexit is set.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `shell.errexit`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/exit-codes.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/exit-codes.mjs)

```js
// Exit codes are reported on the result; errors are thrown only when asked for.
import { $, shell } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'exit-codes', title: 'Exit codes and errors' },
  async ({ record }) => {
    record('successful command', (await $q`sh -c 'exit 0'`).code);
    record('failing command', (await $q`sh -c 'exit 42'`).code);
    record(
      'stderr of a failing command',
      (await $q`sh -c 'echo nope >&2; exit 1'`).stderr
    );

    // With errexit (set -e) a non-zero exit code becomes an exception.
    shell.errexit(true);
    try {
      await $q`sh -c 'exit 42'`;
      record('errexit', 'no error thrown');
    } catch (error) {
      record('errexit throws', { code: error.code, hasResult: !!error.result });
    } finally {
      shell.errexit(false);
    }

    record('after disabling errexit', (await $q`sh -c 'exit 42'`).code);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# exit-codes — Exit codes and errors
successful command: 0
failing command: 42
stderr of a failing command: "nope\n"
errexit throws: {"code":42,"hasResult":true}
after disabling errexit: 42
```

## Rust

**API:** `CommandResult::code`, `CommandResult::error_for_status`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn exit_codes() -> ExampleResult {
    let result = quiet("false").await?;
    let checked = result.clone().error_for_status().unwrap_err();
    Ok(vec![
        observation("result code", result.code),
        observation("checked error code", checked.code()),
    ])
}
```

### Output

```
# exit-codes — Rust
result code: 1
checked error code: 1
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
const { exitCode } = await $`exit 3`.nothrow(); // throws without .nothrow()
```

### [zx](https://github.com/google/zx)

```js
const { exitCode } = await $({ nothrow: true })`exit 3`; // throws without nothrow
```

### [execa](https://github.com/sindresorhus/execa)

```js
const { exitCode } = await execa({ reject: false })`sh -c 'exit 3'`; // throws without reject: false
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const code = shell.exec('exit 3', { silent: true }).code; // never throws
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
// execFile rejects on a non-zero exit; the code is on error.code
```

---

[← All features](../README.md)
