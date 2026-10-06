# Execa compatibility mode

The isolated command-stream/execa entry and general $.execa expose Execa 9.6.1; Rust has portable exact-argv counterparts with explicit limits.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$.execa`, `$.execaCompat`, `command-stream/execa`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/execa-compat.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/execa-compat.mjs)

```js
// Execa uses exact argv, with isolated and general entry points.
import { $ } from '../../src/$.mjs';
import { execa } from '../../src/execa/index.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'execa-compat', title: 'Execa compatibility mode' },
  async ({ record }) => {
    record('isolated and general API', $.execa === execa);
    const script = 'process.stdout.write(process.argv.slice(1).join("|"))';
    record(
      'exact argv',
      (await $.execa(process.execPath, ['-e', script, 'hello world', '$HOME']))
        .stdout
    );
    const api = $.execaCompat({ stripFinalNewline: false });
    record(
      'preserved newline',
      (await api.execa(process.execPath, ['-e', 'console.log("hello")'])).stdout
    );
    record(
      'tolerated exit code',
      (
        await api.execa(process.execPath, ['-e', 'process.exit(3)'], {
          reject: false,
        })
      ).exitCode
    );
    record(
      'binary stdin',
      (
        await execa(
          process.execPath,
          ['-e', 'process.stdin.pipe(process.stdout)'],
          { input: 'input' }
        )
      ).stdout
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# execa-compat — Execa compatibility mode
isolated and general API: true
exact argv: "hello world|$HOME"
preserved newline: "hello\n"
tolerated exit code: 3
binary stdin: "input"
```

## Rust

**API:** `execa`, `execa_compat`, `execa::Execa`, `execa::Options`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn execa_compat() -> ExampleResult {
    use command_stream::execa::{Execa, Options};
    let isolated = command_stream::execa::execa("node", ["--version"]).await?;
    let general = command_stream::execa("node", ["--version"]).await?;
    let argv = command_stream::execa(
        "node",
        [
            "-e",
            "process.stdout.write(process.argv.slice(1).join('|'))",
            "hello world",
            "$HOME",
        ],
    )
    .await?;
    let api = Execa::new(Options {
        strip_final_newline: false,
        ..Options::default()
    });
    let newline = api.command("node", ["-e", "console.log('hello')"]).await?;
    let tolerated = api
        .command("node", ["-e", "process.exit(3)"])
        .reject(false)
        .await?;
    let input = command_stream::execa("node", ["-e", "process.stdin.pipe(process.stdout)"])
        .input(b"input".to_vec())
        .await?;
    Ok(vec![
        observation(
            "isolated and general API",
            isolated.stdout == general.stdout,
        ),
        observation("exact argv", argv.text()),
        observation("preserved newline", newline.text()),
        observation("tolerated exit code", tolerated.exit_code),
        observation("binary stdin", input.text()),
    ])
}
```

### Output

```
# execa-compat — Rust
isolated and general API: true
exact argv: "hello world|$HOME"
preserved newline: "hello\n"
tolerated exit code: 3
binary stdin: "input"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun Shell has a different API.

### [zx](https://github.com/google/zx)

Not supported — zx has a different API.

### [execa](https://github.com/sindresorhus/execa)

```js
import { execa } from 'execa';
await execa('node', ['--version']);
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — ShellJS has a different API.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — spawn does not expose Execa results or helpers.

---

[← All features](../README.md)
