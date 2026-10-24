# Remove environment variables

An `env` value of `undefined` drops that variable from the child, like `env -u NAME`.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `env`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/env-removal.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/env-removal.mjs)

```js
// An env value of undefined removes that variable from the child's environment.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'env-removal', title: 'Remove environment variables' },
  async ({ record }) => {
    const env = { ...process.env, DEMO_KEEP: 'kept', DEMO_DROP: 'dropped' };

    const kept = await $({ mirror: false, env })`printenv DEMO_KEEP`;
    record('kept variable', kept.stdout);

    // `env -u DEMO_DROP`: the variable is absent, not merely empty.
    const removed = await $({
      mirror: false,
      env: { ...env, DEMO_DROP: undefined },
    })`printenv DEMO_DROP`;
    record('removed variable exit code', removed.code);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# env-removal — Remove environment variables
kept variable: "kept\n"
removed variable exit code: 1
```

## Rust

**API:** `RunOptions::env_remove`, `StreamingRunner::env_remove`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn env_removal() -> ExampleResult {
    let env: HashMap<String, String> = std::env::vars()
        .chain([
            ("DEMO_KEEP".to_string(), "kept".to_string()),
            ("DEMO_DROP".to_string(), "dropped".to_string()),
        ])
        .collect();
    let kept = exec(
        "printenv DEMO_KEEP",
        RunOptions {
            env: Some(env.clone()),
            ..quiet_options()
        },
    )
    .await?;

    // `env -u DEMO_DROP`: the variable is absent, not merely empty.
    let removed = StreamingRunner::from_argv("printenv", ["DEMO_DROP"])
        .env(env)
        .env_remove("DEMO_DROP")
        .collect()
        .await?;
    Ok(vec![
        observation("kept variable", kept.stdout),
        observation("removed variable exit code", removed.code),
    ])
}
```

### Output

```
# env-removal — Rust
kept variable: "kept\n"
removed variable exit code: 1
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
const { NAME, ...env } = process.env;
await $`printenv NAME`.env(env).nothrow();
```

### [zx](https://github.com/google/zx)

```js
await $({ env: { ...process.env, NAME: undefined } })`printenv NAME`;
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa({ env: { NAME: undefined } })`printenv NAME`;
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — commands share shell.env; delete the key process-wide.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
const { NAME, ...env } = process.env;
execFile('printenv', ['NAME'], { env });
```

---

[← All features](../README.md)
