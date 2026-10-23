# Writing to stdin while a command runs

Input can be supplied up front or written to a running command.

**Category:** Streaming

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#stdin`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/stdin-streaming.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/stdin-streaming.mjs)

```js
// .streams.stdin gives write access to a running command.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'stdin-streaming', title: 'Writing to stdin while a command runs' },
  async ({ record }) => {
    const runner = $q`cat`;
    const stdin = await runner.streams.stdin;
    stdin.write('first line\n');
    stdin.write('second line\n');
    stdin.end();
    record('what cat echoed back', (await runner).stdout);

    // A whole string can also be handed over up front.
    record(
      'stdin option',
      (await $({ mirror: false, stdin: 'up front\n' })`cat`).stdout
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# stdin-streaming — Writing to stdin while a command runs
what cat echoed back: "first line\nsecond line\n"
stdin option: "up front\n"
```

## Rust

**API:** `ProcessRunner::write_stdin`, `ProcessRunner::close_stdin`, `ProcessRunner::from_argv`, `StreamingRunner::stdin_pipe`, `OutputStream::write_stdin`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn stdin_streaming() -> ExampleResult {
    // `from_argv` runs the program with exactly these arguments, no shell.
    let mut runner = ProcessRunner::from_argv(
        "cat",
        Vec::<String>::new(),
        RunOptions {
            mirror: false,
            stdin: StdinOption::Pipe,
            ..RunOptions::default()
        },
    );
    runner.start().await?;
    runner.write_stdin("first line\n").await?;
    runner.write_stdin("second line\n").await?;
    runner.close_stdin().await?;
    let result = runner.run().await?;

    // A streaming command keeps stdin open with `stdin_pipe`, so input can
    // answer output.
    let mut stream = StreamingRunner::from_argv("cat", Vec::<String>::new())
        .stdin_pipe()
        .stream();
    stream.write_stdin("ping\n").await?;
    let mut answered = Vec::new();
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Stdout(data) = chunk {
            answered.extend(data);
            stream.close_stdin().await?;
        }
    }
    Ok(vec![
        observation("what cat echoed back", result.stdout),
        observation("streamed reply", String::from_utf8(answered)?),
    ])
}
```

### Output

```
# stdin-streaming — Rust
what cat echoed back: "first line\nsecond line\n"
streamed reply: "ping\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`cat < ${new Response('x')}`.quiet(); // a value, not a live stream
```

### [zx](https://github.com/google/zx)

```js
const p = $`cat`;
p.stdin.write('x');
p.stdin.end();
```

### [execa](https://github.com/sindresorhus/execa)

```js
const p = execa`cat`;
p.stdin.write('x');
p.stdin.end();
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.ShellString('x').exec('cat'); // value only
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const p = spawn('cat');
p.stdin.write('x');
p.stdin.end();
```

---

[← All features](../README.md)
