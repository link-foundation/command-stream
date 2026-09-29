# Options: capture, cwd, env, stdin

Execution options control capture, cwd, environment and stdin for a command or reusable runner.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `create`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/options.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/options.mjs)

```js
// $({ ... }) configures capture, mirroring, cwd, env and stdin.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import path from 'path';
import fs from 'fs';

await example(
  { id: 'options', title: 'Options: capture, cwd, env, stdin' },
  async ({ record }) => {
    const dir = makeTempDir('options');
    fs.writeFileSync(path.join(dir, 'marker.txt'), 'here\n');

    record(
      'captured output',
      (await $({ mirror: false, capture: true })`echo captured`).stdout
    );
    record(
      'capture disabled',
      (await $({ mirror: false, capture: false })`echo dropped`).stdout
    );

    const inDir = await $({ mirror: false, cwd: dir })`ls`;
    record('cwd option', inDir.stdout);

    const withEnv = await $({
      mirror: false,
      env: { ...process.env, DEMO_VALUE: 'from-env' },
    })`printenv DEMO_VALUE`;
    record('env option', withEnv.stdout);

    const withStdin = await $({ mirror: false, stdin: 'piped in\n' })`cat`;
    record('stdin option', withStdin.stdout);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# options — Options: capture, cwd, env, stdin
captured output: "captured\n"
capture disabled: undefined
cwd option: "marker.txt\n"
env option: "from-env\n"
stdin option: "piped in\n"
```

## Rust

**API:** `exec`, `RunOptions`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn options() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let mut env = HashMap::new();
    env.insert(
        "COMMAND_STREAM_DEMO".to_string(),
        "from-options".to_string(),
    );
    let result = exec(
        "cat",
        RunOptions {
            mirror: false,
            cwd: Some(directory.path().to_path_buf()),
            env: Some(env),
            stdin: StdinOption::Content("from-stdin\n".to_string()),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![observation("stdin and cwd options", result.stdout)])
}
```

### Output

```
# options — Rust
stdin and cwd options: "from-stdin\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`pwd`.cwd('/tmp').env({ KEY: 'value' }).quiet();
```

### [zx](https://github.com/google/zx)

```js
const $$ = $({ cwd: '/tmp', env: { KEY: 'value' } });
```

### [execa](https://github.com/sindresorhus/execa)

```js
const run = execa({ cwd: '/tmp', env: { KEY: 'value' } });
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.cd('/tmp');
shell.env.KEY = 'value'; // process-wide, not per command
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('pwd', [], { cwd: '/tmp', env: { KEY: 'value' } });
```

---

[← All features](../README.md)
