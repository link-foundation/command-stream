# Read the output with text()

Captured stdout is available as text through each language’s result API.

**Category:** Reading output

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#text`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/result-text.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/result-text.mjs)

```js
// Every result exposes an async text() method, like Bun's built-in $.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'result-text', title: 'Read the output with text()' },
  async ({ record }) => {
    record('system command', await (await $q`sh -c 'echo system'`).text());
    record('built-in command', await (await $q`echo built-in`).text());
    record('synchronous command', await $q`echo sync`.sync().text());
    record('pipeline', await (await $q`echo piped | cat`).text());

    register('text-demo', async () => ({ stdout: 'virtual\n', code: 0 }));
    record('virtual command', await (await $q`text-demo`).text());
    unregister('text-demo');
  }
);
```

### Output

Identical in Node.js and Bun:

```
# result-text — Read the output with text()
system command: "system\n"
built-in command: "built-in\n"
synchronous command: "sync\n"
pipeline: "piped\n"
virtual command: "virtual\n"
```

## Rust

**API:** `CommandResult::stdout`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn result_text() -> ExampleResult {
    let result = quiet("echo hello").await?;
    Ok(vec![observation("text output", result.stdout)])
}
```

### Output

```
# result-text — Rust
text output: "hello\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
const text = await $`echo hi`.text();
```

### [zx](https://github.com/google/zx)

```js
const text = (await $`echo hi`).toString();
```

### [execa](https://github.com/sindresorhus/execa)

```js
const text = (await execa`echo hi`).stdout;
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
const text = shell.exec('echo hi', { silent: true }).stdout;
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const text = (await promisify(execFile)('echo', ['hi'])).stdout;
```

---

[← All features](../README.md)
