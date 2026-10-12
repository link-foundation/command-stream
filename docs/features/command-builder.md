# Build commands with literal arguments

Immutable command descriptions execute exact argv and support fluent option transforms.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `command`, `CommandBuilder`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/command-builder.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/command-builder.mjs)

```js
import { command } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'command-builder', title: 'Build commands with literal arguments' },
  async ({ record }) => {
    const builder = command(
      process.execPath,
      '-e',
      'console.log(process.argv[1])',
      'hello ; $HOME'
    );
    record('literal argument', (await (await builder).text()).trim());
    record(
      'exit code',
      await command(process.execPath, '-e', 'process.exit(7)')
        .pipe(command.exitCode)
        .run()
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# command-builder — Build commands with literal arguments
literal argument: "hello ; $HOME"
exit code: 7
```

## Rust

**API:** `CommandBuilder`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn command_builder() -> ExampleResult {
    let result = CommandBuilder::new("printf")
        .args(["%s", "hello ; $HOME"])
        .run()
        .await?;
    Ok(vec![
        observation("literal argument", result.stdout),
        observation(
            "exit code",
            CommandBuilder::new("sh")
                .args(["-c", "exit 7"])
                .exit_code()
                .await?,
        ),
    ])
}
```

### Output

```
# command-builder — Rust
literal argument: "hello ; $HOME"
exit code: 7
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No command-stream transform API; invoke the executable with separate arguments.

### [zx](https://github.com/google/zx)

Not supported — No command-stream transform API; invoke the executable with separate arguments.

### [execa](https://github.com/sindresorhus/execa)

```js
await execa('printf', ['%s', 'literal ; text']);
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No command-stream transform API; invoke the executable with separate arguments.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
spawn('printf', ['%s', 'literal ; text']);
```

---

[← All features](../README.md)
