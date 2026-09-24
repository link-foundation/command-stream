# The built-in command catalog

Common commands are implemented in-process in both languages for portable behavior.

**Category:** Built-in commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `listCommands`, `enableVirtualCommands`, `disableVirtualCommands`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/builtin-catalog.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/builtin-catalog.mjs)

```js
// command-stream ships built-in implementations of common shell commands, so
// scripts behave the same even where those binaries are missing.
import {
  $,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
} from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'builtin-catalog', title: 'The built-in command catalog' },
  async ({ record }) => {
    record('available built-ins', listCommands().sort());
    record('number of built-ins', listCommands().length);

    // Built-ins can be switched off, which falls back to the real binaries.
    record('with built-ins', (await $q`echo built-in`).stdout);
    disableVirtualCommands();
    record('with built-ins disabled', (await $q`echo real binary`).stdout);
    enableVirtualCommands();
    record('built-ins enabled again', listCommands().length > 0);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# builtin-catalog — The built-in command catalog
available built-ins: ["basename","cat","cd","cp","dirname","echo","env","exit","false","ls","mkdir","mv","pwd","rm","seq","sleep","tee","test","touch","true","which","yes"]
number of built-ins: 22
with built-ins: "built-in\n"
with built-ins disabled: "real binary\n"
built-ins enabled again: true
```

## Rust

**API:** `VirtualCommandRegistry::with_builtins`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn builtin_catalog() -> ExampleResult {
    let registry = VirtualCommandRegistry::with_builtins();
    let mut commands = registry.list();
    commands.sort_unstable();
    Ok(vec![
        observation("available built-ins", &commands),
        observation("number of built-ins", commands.len()),
    ])
}
```

### Output

```
# builtin-catalog — Rust
available built-ins: ["basename","cat","cd","cp","dirname","echo","env","exit","false","ls","mkdir","mv","pwd","rm","seq","sleep","tee","test","touch","true","which","yes"]
number of built-ins: 22
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
// a fixed set of built-ins (cd, echo, ls, rm, ...) that cannot be listed or turned off
```

### [zx](https://github.com/google/zx)

Not supported — every command is handed to the system shell; the fs and glob helpers are separate APIs, not commands.

### [execa](https://github.com/sindresorhus/execa)

Not supported — every command is a real binary.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.ls();
shell.cat();
shell.mkdir(); // built-ins, but as functions rather than commands
```

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — every command is a real binary.

---

[← All features](../README.md)
