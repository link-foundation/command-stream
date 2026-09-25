# Redirecting output and input

> , >> and < redirect command input and output with shell-compatible behavior.

**Category:** Shell syntax

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/redirection.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/redirection.mjs)

```js
// Output and input redirection work with built-ins and with your own commands,
// without handing the command line to a real shell.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example(
  { id: 'redirection', title: 'Redirecting output and input' },
  async ({ record }) => {
    const dir = makeTempDir('redirect');
    const file = path.join(dir, 'out.txt');
    const $q = $({ mirror: false });

    const written = await $q`echo first > ${file}`;
    record('the command itself prints nothing', written.stdout);
    record('the file holds the output', fs.readFileSync(file, 'utf8'));

    await $q`echo second >> ${file}`;
    record('>> appends', fs.readFileSync(file, 'utf8'));

    const numbers = path.join(dir, 'numbers.txt');
    await $q`seq 1 3 | cat > ${numbers}`;
    record('a pipeline can redirect too', fs.readFileSync(numbers, 'utf8'));

    record('< feeds a command from a file', (await $q`cat < ${file}`).stdout);
    record(
      'a quoted > stays a literal argument',
      (await $q`echo "a > b"`).stdout
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# redirection — Redirecting output and input
the command itself prints nothing: ""
the file holds the output: "first\n"
>> appends: "first\nsecond\n"
a pipeline can redirect too: "1\n2\n3\n"
< feeds a command from a file: "first\nsecond\n"
a quoted > stays a literal argument: "a > b\n"
```

## Rust

**API:** `exec`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn redirection() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let file = directory.path().join("output.txt");
    let result = exec(
        "echo redirected > output.txt",
        RunOptions {
            mirror: false,
            cwd: Some(directory.path().to_path_buf()),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![
        observation("exit code", result.code),
        observation("file contents", std::fs::read_to_string(file)?),
    ])
}
```

### Output

```
# redirection — Rust
exit code: 0
file contents: "redirected\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`echo hi > out.txt`;
```

### [zx](https://github.com/google/zx)

```js
await $`echo hi > out.txt`; // handled by the system shell
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa({ stdout: { file: 'out.txt' } })`echo hi`;
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.echo('hi').to('out.txt');
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
spawn('echo', ['hi'], {
  stdio: ['ignore', fs.openSync('out.txt', 'w'), 'inherit'],
});
```

---

[← All features](../README.md)
