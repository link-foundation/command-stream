# Mirroring and capturing output

Output can be shown, captured, both or neither, chosen independently.

**Category:** Reading output

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `create`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/mirror-capture.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/mirror-capture.mjs)

```js
// mirror controls whether output is shown, capture whether it is kept.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'mirror-capture', title: 'Mirroring and capturing output' },
  async ({ record }) => {
    // The default: output is shown and captured.
    const both = await $`echo shown and captured`;
    record('default mirror', true);
    record('default capture', both.stdout);

    const quiet = await $({ mirror: false })`echo only captured`;
    record('mirror: false still captures', quiet.stdout);

    const dropped = await $({ mirror: false, capture: false })`echo neither`;
    record('capture: false returns no stdout', dropped.stdout);
  }
);
```

### Output

Identical in Node.js and Bun:

```
shown and captured
# mirror-capture — Mirroring and capturing output
default mirror: true
default capture: "shown and captured\n"
mirror: false still captures: "only captured\n"
capture: false returns no stdout: undefined
```

## Rust

**API:** `RunOptions::mirror`, `RunOptions::capture`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn mirror_capture() -> ExampleResult {
    let captured = quiet("echo captured").await?;
    let uncaptured = exec(
        "true",
        RunOptions {
            mirror: false,
            capture: false,
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![
        observation("captured output", captured.stdout),
        observation("capture can be disabled", uncaptured.stdout.is_empty()),
    ])
}
```

### Output

```
# mirror-capture — Rust
captured output: "captured\n"
capture can be disabled: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`echo hi`; // shown and captured
await $`echo hi`.quiet(); // captured only
```

### [zx](https://github.com/google/zx)

```js
$.verbose = true; // shown and captured
await $({ quiet: true })`echo hi`;
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa({ stdout: ['pipe', 'inherit'] })`echo hi`; // both, by listing destinations
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.exec('echo hi'); // shown and captured
shell.exec('echo hi', { silent: true }); // captured only
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
spawn('echo', ['hi'], { stdio: 'inherit' }); // shown, but then not captured
```

---

[← All features](../README.md)
