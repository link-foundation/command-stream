# Registering your own commands

A handler can be registered by name and invoked through a registry or command runner.

**Category:** Your own commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `register`, `unregister`, `listCommands`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/virtual-commands.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/virtual-commands.mjs)

```js
// Any JavaScript function can be registered as a command and then used from a
// command line like a real binary.
import { $, register, unregister, listCommands } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'virtual-commands', title: 'Registering your own commands' },
  async ({ record }) => {
    register('greet', async ({ args }) => ({
      stdout: `Hello, ${args.join(' ') || 'world'}!\n`,
      code: 0,
    }));

    record('the command is registered', listCommands().includes('greet'));
    record('without arguments', (await $q`greet`).stdout);
    record('with arguments', (await $q`greet Node and Bun`).stdout);

    // A handler decides its own exit code and may write to stderr.
    register('fail-with', async ({ args }) => ({
      stderr: `failing on purpose\n`,
      code: Number(args[0] ?? 1),
    }));
    const failed = await $q`fail-with 42`;
    record('custom exit code', failed.code);
    record('custom stderr', failed.stderr);

    unregister('greet');
    unregister('fail-with');
    record('unregistered again', listCommands().includes('greet'));
  }
);
```

### Output

Identical in Node.js and Bun:

```
# virtual-commands — Registering your own commands
the command is registered: true
without arguments: "Hello, world!\n"
with arguments: "Hello, Node and Bun!\n"
custom exit code: 42
custom stderr: "failing on purpose\n"
unregistered again: false
```

## Rust

**API:** `VirtualCommandRegistry::register`, `VirtualCommandRegistry::unregister`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn virtual_commands() -> ExampleResult {
    let mut registry = VirtualCommandRegistry::new();
    registry.register("greet", greet_handler);
    let handler = registry.get("greet").expect("registered handler");
    let result = handler(CommandContext::new(vec!["Rust".to_string()])).await;
    let removed = registry.unregister("greet");
    Ok(vec![
        observation("custom command output", result.stdout),
        observation("unregistered again", removed),
    ])
}
```

### Output

```
# virtual-commands — Rust
custom command output: "Hello, Rust!\n"
unregistered again: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — the built-in set is fixed; a name cannot be bound to a JavaScript function.

### [zx](https://github.com/google/zx)

Not supported — a command name always resolves to a binary in PATH.

### [execa](https://github.com/sindresorhus/execa)

Not supported — a command name always resolves to a binary in PATH.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
require('shelljs/plugin').register('greet', (options, name) => `hi ${name}\n`);
shell.greet('bob'); // a method, not a command usable inside a pipeline string
```

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — a command name always resolves to a binary in PATH.

---

[← All features](../README.md)
