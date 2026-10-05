# File system built-ins

ls, cat, mkdir, touch, cp, mv, rm and test run in-process.

**Category:** Built-in commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/builtin-filesystem.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/builtin-filesystem.mjs)

```js
// File system built-ins: mkdir, touch, ls, cp, mv, rm.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example(
  { id: 'builtin-filesystem', title: 'File system built-ins' },
  async ({ record }) => {
    const dir = makeTempDir('fs');
    const $q = $({ mirror: false, cwd: dir });

    await $q`mkdir -p project/src`;
    record(
      'mkdir -p created the tree',
      fs.existsSync(path.join(dir, 'project/src'))
    );

    await $q`touch project/src/index.mjs`;
    record(
      'touch created the file',
      fs.existsSync(path.join(dir, 'project/src/index.mjs'))
    );

    record('ls', (await $q`ls project/src`).stdout);

    await $q`cp project/src/index.mjs project/src/copy.mjs`;
    record('after cp', (await $q`ls project/src`).stdout);

    await $q`mv project/src/copy.mjs project/src/renamed.mjs`;
    record('after mv', (await $q`ls project/src`).stdout);

    await $q`rm project/src/renamed.mjs`;
    record('after rm', (await $q`ls project/src`).stdout);

    await $q`rm -rf project`;
    record(
      'the tree still exists after rm -rf',
      fs.existsSync(path.join(dir, 'project'))
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# builtin-filesystem — File system built-ins
mkdir -p created the tree: true
touch created the file: true
ls: "index.mjs\n"
after cp: "copy.mjs\nindex.mjs\n"
after mv: "index.mjs\nrenamed.mjs\n"
after rm: "index.mjs\n"
the tree still exists after rm -rf: false
```

## Rust

**API:** `mkdir`, `touch`, `ls`, `rm`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn builtin_filesystem() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let options = RunOptions {
        mirror: false,
        cwd: Some(directory.path().to_path_buf()),
        ..RunOptions::default()
    };
    exec("mkdir demo", options.clone()).await?;
    exec("touch demo/file.txt", options.clone()).await?;
    let listed = exec("ls demo", options.clone()).await?;
    exec("rm -r demo", options).await?;
    Ok(vec![observation("created and listed", listed.stdout)])
}
```

### Output

```
# builtin-filesystem — Rust
created and listed: "file.txt\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`mkdir -p dir`;
await $`ls dir`.text(); // built-in, same idea
```

### [zx](https://github.com/google/zx)

```js
await fs.mkdirp('dir'); // zx re-exports fs-extra instead of implementing commands
```

### [execa](https://github.com/sindresorhus/execa)

Not supported — use node:fs.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.mkdir('-p', 'dir');
shell.ls('dir');
```

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — use node:fs.

---

[← All features](../README.md)
