# The handler context

A handler receives args, stdin, cwd, env and a cancellation signal.

**Category:** Your own commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `register`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/virtual-context.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/virtual-context.mjs)

```js
// A command handler receives a context object describing how it was invoked.
import { $, register, unregister } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example(
  { id: 'virtual-context', title: 'The handler context' },
  async ({ record }) => {
    const dir = makeTempDir('context');

    register('describe', async ({ args, stdin, cwd, env, options }) => ({
      stdout:
        JSON.stringify({
          args,
          stdin,
          cwdIsTheOneWeAskedFor: cwd === dir,
          envValue: env.DEMO,
          mirror: options.mirror,
        }) + '\n',
      code: 0,
    }));

    const result = await $({
      mirror: false,
      cwd: dir,
      env: { DEMO: 'from-options' },
    })`echo piped | describe one two`;
    record('context seen by the handler', JSON.parse(result.stdout));

    unregister('describe');
  }
);
```

### Output

Identical in Node.js and Bun:

```
# virtual-context — The handler context
context seen by the handler: {"args":["one","two"],"stdin":"piped\n","cwdIsTheOneWeAskedFor":true,"envValue":"from-options","mirror":false}
```

## Rust

**API:** `CommandContext`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn virtual_context() -> ExampleResult {
    let mut context = CommandContext::new(vec!["one".to_string(), "two".to_string()]);
    context.stdin = Some("piped\n".to_string());
    context.cwd = Some(std::env::temp_dir());
    context.env = Some(HashMap::from([("DEMO".to_string(), "value".to_string())]));
    Ok(vec![observation(
        "handler context",
        json!({
            "args": context.args,
            "stdin": context.stdin,
            "has_cwd": context.cwd.is_some(),
            "env_value": context.env.and_then(|env| env.get("DEMO").cloned()),
        }),
    )])
}
```

### Output

```
# virtual-context — Rust
handler context: {"args":["one","two"],"env_value":"value","has_cwd":true,"stdin":"piped\n"}
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — no handler API.

### [zx](https://github.com/google/zx)

Not supported — no handler API.

### [execa](https://github.com/sindresorhus/execa)

Not supported — no handler API.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
require('shelljs/plugin').readFromPipe(); // stdin only; no cwd, env or cancellation
```

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — no handler API.

---

[← All features](../README.md)
