# ShellJS compatibility mode

The pinned JavaScript ShellJS API and Rust async session counterpart preserve separate arguments and error statuses, with explicit translation limits.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$.shelljs`, `shelljs`, `command-stream/shelljs`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/shelljs-compat.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/shelljs-compat.mjs)

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, shelljs } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example(
  { id: 'shelljs-compat', title: 'ShellJS compatibility mode' },
  async ({ record }) => {
    shelljs.config.silent = true;
    const directory = makeTempDir('shelljs');
    const file = join(directory, 'file with spaces');
    writeFileSync(file, 'z\na\na\nb\n');
    record('general API', $.shelljs === shelljs);
    record('separate arguments', shelljs.echo('hello', 'two words').stdout);
    record('head', shelljs.head({ '-n': 2 }, file).stdout);
    record('tail', shelljs.tail('-n', '2', file).stdout);
    record('missing file code', shelljs.cat(join(directory, 'missing')).code);
    shelljs.config.reset();
  }
);
```

### Output

Identical in Node.js and Bun:

```
hello two words
# shelljs-compat — ShellJS compatibility mode
general API: true
separate arguments: "hello two words\n"
head: "z\na\n"
tail: "a\nb\n"
missing file code: 1
```

## Rust

**API:** `shelljs::ShellJs`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn shelljs_compat() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    std::fs::write(directory.path().join("file with spaces"), "z\na\na\nb\n")?;
    let mut shell = command_stream::shelljs::ShellJs::new();
    shell.config.silent = true;
    shell
        .cd(&[directory.path().to_str().ok_or("non-UTF8 path")?])
        .await?;
    Ok(vec![
        observation("general API", true),
        observation(
            "separate arguments",
            shell.echo(&["hello", "two words"]).await?.stdout,
        ),
        observation(
            "head",
            shell.head(&["-n", "2", "file with spaces"]).await?.stdout,
        ),
        observation(
            "tail",
            shell.tail(&["-n", "2", "file with spaces"]).await?.stdout,
        ),
        observation("missing file code", shell.cat(&["missing"]).await?.code),
    ])
}
```

### Output

```
# shelljs-compat — Rust
general API: true
separate arguments: "hello two words\n"
head: "z\na\n"
tail: "a\nb\n"
missing file code: 1
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun Shell has a different API.

### [zx](https://github.com/google/zx)

Not supported — zx has a different API.

### [execa](https://github.com/sindresorhus/execa)

Not supported — Execa has a different API.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
import shell from 'shelljs';
shell.head({ '-n': 2 }, 'file');
```

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — no portable ShellJS command layer.

---

[← All features](../README.md)
