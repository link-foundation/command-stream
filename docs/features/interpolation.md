# Safe interpolation

Interpolated values are escaped as arguments; each language also exposes an explicit raw form.

**Category:** Shell syntax

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `quote`, `raw`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/interpolation.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/interpolation.mjs)

```js
// Interpolated values are quoted automatically, so user input cannot turn into
// extra shell syntax.
import { $, quote, raw } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'interpolation', title: 'Safe interpolation' },
  async ({ record }) => {
    const name = "it's a name";
    record('quotes are handled', (await $q`echo ${name}`).stdout);

    const dangerous = 'hello; rm -rf /tmp/nothing';
    record(
      'injection stays one argument',
      (await $q`echo ${dangerous}`).stdout
    );

    const args = ['one', 'two three'];
    record(
      'an array becomes separate arguments',
      (await $q`echo ${args}`).stdout
    );

    record('quote() shows what interpolation does', quote("it's a name"));

    // raw() opts out of quoting when you really mean shell syntax.
    record('raw() keeps shell syntax', (await $q`echo ${raw('a b')}`).stdout);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# interpolation — Safe interpolation
quotes are handled: "it's a name\n"
injection stays one argument: "hello; rm -rf <tmp>/nothing\n"
an array becomes separate arguments: "one two three\n"
quote() shows what interpolation does: "'it'\\''s a name'"
raw() keeps shell syntax: "a b\n"
```

## Rust

**API:** `cmd!`, `quote`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn interpolation() -> ExampleResult {
    let value = "hello from Rust";
    let result = cmd!("echo {}", value).await?;
    Ok(vec![observation("macro interpolation", result.stdout)])
}
```

### Output

```
# interpolation — Rust
macro interpolation: "hello from Rust\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`echo ${value}`; // escaped; $.escape(value) shows the result
```

### [zx](https://github.com/google/zx)

```js
await $`echo ${value}`; // escaped; quote(value) shows the result
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa`echo ${value}`; // passed as an argument, no shell to escape for
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — shell.exec takes a string, so escaping is the caller’s job.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('echo', [value]); // arguments are never parsed as shell syntax
```

---

[← All features](../README.md)
