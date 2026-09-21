# Command sequences

&&, ||, ; and parentheses execute with the expected shell semantics.

**Category:** Shell syntax

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/sequences.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/sequences.mjs)

```js
// Operators between commands: && runs on success, || runs on failure,
// ; runs unconditionally and ( ) groups commands into a subshell.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'sequences', title: 'Command sequences' },
  async ({ record }) => {
    record('&& after a success', (await $q`true && echo ran`).stdout);
    record('&& after a failure', (await $q`false && echo ran`).stdout);
    record('|| after a failure', (await $q`false || echo fallback`).stdout);
    record('|| after a success', (await $q`true || echo fallback`).stdout);
    record('; runs both', (await $q`echo one ; echo two`).stdout);
    record('( ) groups commands', (await $q`(echo a ; echo b)`).stdout);

    const chain = await $q`false && echo skipped`;
    record('exit code of a short-circuited chain', chain.code);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# sequences — Command sequences
&& after a success: "ran\n"
&& after a failure: ""
|| after a failure: "fallback\n"
|| after a success: ""
; runs both: "one\ntwo\n"
( ) groups commands: "a\nb\n"
exit code of a short-circuited chain: 1
```

## Rust

**API:** `exec`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn sequences() -> ExampleResult {
    let result = quiet("false || echo fallback; echo next").await?;
    Ok(vec![observation("sequence output", result.stdout)])
}
```

### Output

```
# sequences — Rust
sequence output: "fallback\nnext\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`mkdir -p dir && cd dir && pwd`.text();
```

### [zx](https://github.com/google/zx)

```js
await $`mkdir -p dir && cd dir && pwd`; // the system shell runs it
```

### [execa](https://github.com/sindresorhus/execa)

Not supported — no shell operators unless the shell option is turned on, which gives up escaping.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.exec('mkdir -p dir && cd dir && pwd'); // the system shell runs it
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('sh', ['-c', 'mkdir -p dir && cd dir && pwd']);
```

---

[← All features](../README.md)
