# Text and value built-ins

echo, seq, yes, basename, dirname, true and false run in-process.

**Category:** Built-in commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/builtin-text.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/builtin-text.mjs)

```js
// Text and value built-ins: echo, cat, seq, basename, dirname, true, false, test.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example(
  { id: 'builtin-text', title: 'Text and value built-ins' },
  async ({ record }) => {
    const dir = makeTempDir('text');
    const file = path.join(dir, 'greeting.txt');
    fs.writeFileSync(file, 'hello from a file\n');
    const $q = $({ mirror: false });

    record('echo', (await $q`echo hello`).stdout);
    record('echo -n', (await $q`echo -n no newline`).stdout);
    record('cat', (await $q`cat ${file}`).stdout);
    record('seq', (await $q`seq 1 4`).stdout);
    record('basename', (await $q`basename /usr/local/lib/file.txt`).stdout);
    record('dirname', (await $q`dirname /usr/local/lib/file.txt`).stdout);
    record('true', (await $q`true`).code);
    record('false', (await $q`false`).code);
    record('test on an existing file', (await $q`test -f ${file}`).code);
    record(
      'test on a missing file',
      (await $q`test -f ${path.join(dir, 'missing')}`).code
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# builtin-text — Text and value built-ins
echo: "hello\n"
echo -n: "no newline"
cat: "hello from a file\n"
seq: "1\n2\n3\n4\n"
basename: "file.txt\n"
dirname: "/usr/local/lib\n"
true: 0
false: 1
test on an existing file: 0
test on a missing file: 1
```

## Rust

**API:** `echo`, `seq`, `basename`, `dirname`, `test`, `which`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn builtin_text() -> ExampleResult {
    let sequence = quiet("seq 1 3").await?;
    let basename = quiet("basename /tmp/example.txt").await?;
    Ok(vec![
        observation("sequence", sequence.stdout),
        observation("basename", basename.stdout),
    ])
}
```

### Output

```
# builtin-text — Rust
sequence: "1\n2\n3\n"
basename: "example.txt\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`echo hi`.text(); // echo is a built-in; seq and yes are not
```

### [zx](https://github.com/google/zx)

```js
await $`echo hi`; // the system binaries
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa('echo', ['hi']); // the system binaries
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.echo('hi'); // echo only
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('echo', ['hi']); // the system binaries
```

---

[← All features](../README.md)
