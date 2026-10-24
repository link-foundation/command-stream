# zx compatibility mode

`$.zx` (also `command-stream/zx`) runs zx scripts unchanged: zx quoting, ProcessPromise/ProcessOutput, pipes, `within`, `cd`, `nothrow` and the zx goods.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$.zx`, `command-stream/zx`, `within`, `ProcessOutput`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/zx-compat.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/zx-compat.mjs)

```js
// zx compatibility mode: `$.zx` (or `command-stream/zx`) runs scripts written
// for google/zx unchanged - same quoting, ProcessPromise/ProcessOutput, pipes,
// `within`, `nothrow` and the rest of the zx surface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $ } from '../../src/$.mjs';
import { $ as zx$, within, ProcessOutput } from '../../src/zx/index.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'zx-compat', title: 'zx compatibility mode' },
  async ({ record }) => {
    record('$.zx is the zx $', $.zx === zx$);

    // Interpolated values are quoted the zx way, so spaces survive.
    const words = 'hello world';
    const greeting = await $.zx`echo ${words}`;
    record('interpolation', greeting.stdout);
    record('ProcessOutput', greeting instanceof ProcessOutput);

    // Failing commands reject with a ProcessOutput, unless `nothrow` is set.
    try {
      await $.zx`exit 2`;
    } catch (error) {
      record('rejected exit code', error.exitCode);
    }
    record(
      'nothrow exit code',
      (await $.zx({ nothrow: true })`exit 3`).exitCode
    );

    record('pipe', (await $.zx`printf 'b\na\n'`.pipe($.zx`sort`)).lines());

    // `within` scopes settings such as the working directory.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zx-')));
    try {
      const inside = await within(async () => {
        $.zx.cwd = dir;
        return (await $.zx`pwd`).stdout.trim() === dir;
      });
      record('within cwd', inside);
      record('cwd restored', $.zx.cwd === undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
```

### Output

Identical in Node.js and Bun:

```
# zx-compat — zx compatibility mode
$.zx is the zx $: true
interpolation: "hello world\n"
ProcessOutput: true
rejected exit code: 2
nothrow exit code: 3
pipe: ["a","b"]
within cwd: true
cwd restored: true
```

## Rust

**API:** `zx!`, `zx::Shell`, `zx::within`, `zx::ProcessOutput`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn zx_compat() -> ExampleResult {
    // Interpolated values are quoted the zx way, so spaces survive.
    let words = "hello world";
    let greeting = zx!("echo {}", words).await?;

    // Failing commands return Err(ProcessOutput), unless `nothrow` is set.
    let rejected = zx!("exit 2").await.unwrap_err();
    let tolerated = zx!(zx::Shell::new().nothrow(true), "exit 3").await?;

    let sorted = zx!("printf 'b\\na\\n'").pipe(zx!("sort")).await?;

    // `within` scopes settings such as the working directory.
    let dir = std::env::temp_dir().canonicalize()?;
    let inside = zx::within(async {
        zx::configure(|options| options.cwd = Some(dir.clone()));
        zx!("pwd").await
    })
    .await?;

    Ok(vec![
        observation("interpolation", greeting.stdout),
        observation("rejected exit code", rejected.exit_code),
        observation("nothrow exit code", tolerated.exit_code),
        observation("pipe", sorted.lines()),
        observation("within cwd", inside.stdout.trim() == dir.to_string_lossy()),
        observation("cwd restored", zx::current_options().cwd.is_none()),
    ])
}
```

### Output

```
# zx-compat — Rust
interpolation: "hello world\n"
rejected exit code: 2
nothrow exit code: 3
pipe: ["a","b"]
within cwd: true
cwd restored: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun Shell has its own API; zx scripts need rewriting.

### [zx](https://github.com/google/zx)

```js
import { $, within } from 'zx';
await $`echo ${words}`;
```

### [execa](https://github.com/sindresorhus/execa)

Not supported — execa has its own API; zx scripts need rewriting.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — ShellJS has its own API; zx scripts need rewriting.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — no zx layer; quote and spawn by hand.

---

[← All features](../README.md)
