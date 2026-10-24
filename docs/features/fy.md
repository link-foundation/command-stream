# Translate shell programs into modules

Generate executable ES modules that preserve shell semantics and literal process arguments.

**Category:** Utilities

**Languages:** JavaScript, Rust

## JavaScript

**API:** `fy`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/fy.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/fy.mjs)

```js
import { fy } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'fy', title: 'Translate shell programs into modules' },
  async ({ record }) => {
    const module = fy('echo "$1"; exit 7');
    record(
      'source preserved',
      module.includes(JSON.stringify('echo "$1"; exit 7'))
    );
    record('executable module', module.startsWith('#!/usr/bin/env node\n'));
  }
);
```

### Output

Identical in Node.js and Bun:

```
# fy — Translate shell programs into modules
source preserved: true
executable module: true
```

## Rust

**API:** `fy`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn fy_module() -> ExampleResult {
    let module = fy("echo \"$1\"; exit 7");
    Ok(vec![
        observation(
            "source preserved",
            module.contains(&serde_json::to_string("echo \"$1\"; exit 7")?),
        ),
        observation(
            "executable module",
            module.starts_with("#!/usr/bin/env node\n"),
        ),
    ])
}
```

### Output

```
# fy — Rust
source preserved: true
executable module: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No shell-to-module translator; execute the source with its interpreter.

### [zx](https://github.com/google/zx)

Not supported — No shell-to-module translator; execute the source with its interpreter.

### [execa](https://github.com/sindresorhus/execa)

Not supported — No shell-to-module translator; execute the source with its interpreter.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No shell-to-module translator; execute the source with its interpreter.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — No shell-to-module translator; execute the source with its interpreter.

---

[← All features](../README.md)
