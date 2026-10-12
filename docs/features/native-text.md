# Native head, tail, sort and uniq

Four portable UTF-8 commands handle files and completed stdin, preserve line endings and support strict options, cancellation and output channels.

**Category:** Built-in commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `head`, `tail`, `sort`, `uniq`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/native-text.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/native-text.mjs)

```js
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'native-text', title: 'Native text commands' },
  async ({ record }) => {
    const input = 'b\nb\na\n';
    const quiet = $({ stdin: input, mirror: false });
    record('head', (await quiet`head -n 2`).stdout.toString());
    record('tail', (await quiet`tail -n 1`).stdout.toString());
    record('sort', (await quiet`sort -u`).stdout.toString());
    record('uniq', (await quiet`uniq -cd`).stdout.toString());
    record('zero lines', (await quiet`tail -n 0`).stdout.toString());
  }
);
```

### Output

Identical in Node.js and Bun:

```
# native-text — Native text commands
head: "b\nb\n"
tail: "a\n"
sort: "a\nb\n"
uniq: "      2 b\n"
zero lines: ""
```

## Rust

**API:** `commands::head`, `commands::tail`, `commands::sort`, `commands::uniq`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn native_text() -> ExampleResult {
    let options = RunOptions {
        stdin: StdinOption::Content("b\nb\na\n".into()),
        ..quiet_options()
    };
    let mut observations = Vec::new();
    for (label, command) in [
        ("head", "head -n 2"),
        ("tail", "tail -n 1"),
        ("sort", "sort -u"),
        ("uniq", "uniq -cd"),
        ("zero lines", "tail -n 0"),
    ] {
        observations.push(observation(
            label,
            ProcessRunner::new(command, options.clone())
                .run()
                .await?
                .stdout,
        ));
    }
    Ok(observations)
}
```

### Output

```
# native-text — Rust
head: "b\nb\n"
tail: "a\n"
sort: "a\nb\n"
uniq: "      2 b\n"
zero lines: ""
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — requires installed head/tail/sort/uniq programs.

### [zx](https://github.com/google/zx)

```js
await $`sort log.txt | uniq -c`; // installed utilities
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa('head', ['-n', '2', 'log.txt']); // installed utility
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.head({ '-n': 2 }, 'log.txt');
shell.sort('log.txt').uniq('-c');
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('head', ['-n', '2', 'log.txt'], callback);
```

---

[← All features](../README.md)
