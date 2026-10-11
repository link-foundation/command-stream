# Compose and extend virtual commands

Typed command packages support registration, composition, middleware, inheritance and atomic reload.

**Category:** Your own commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `create`, `install`, `compose`, `extend`, `inherit`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/command-packages.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/command-packages.mjs)

```js
import $ from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'command-packages', title: 'Compose and extend virtual commands' },
  async ({ record }) => {
    $.create('package-hello', ({ args }) => ({
      code: 0,
      stdout: args.join(' '),
    }));
    try {
      $.inherit('package-greet', 'package-hello', { args: ['hello'] });
      $.extend('package-greet', async (context, next) => {
        const result = await next(context);
        return { ...result, stdout: `${result.stdout}!` };
      });
      record(
        'inherited middleware',
        await (await $({ mirror: false })`package-greet world`).text()
      );
    } finally {
      $.unregister('package-hello');
      $.unregister('package-greet');
    }
  }
);
```

### Output

Identical in Node.js and Bun:

```
# command-packages — Compose and extend virtual commands
inherited middleware: "hello world!"
```

## Rust

**API:** `CommandEnvironment`, `CommandPackage`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn command_packages() -> ExampleResult {
    let mut environment = CommandEnvironment::new();
    environment.create("package-hello", |context| async move {
        CommandResult::success(context.args.join(" "))
    })?;
    environment.inherit("package-greet", "package-hello", vec!["hello".into()])?;
    environment.extend("package-greet", |context, next| {
        Box::pin(async move {
            let result = next(context).await;
            CommandResult::success(format!("{}!", result.stdout))
        })
    })?;
    Ok(vec![observation(
        "inherited middleware",
        environment
            .run("package-greet", CommandContext::new(vec!["world".into()]))
            .await
            .stdout,
    )])
}
```

### Output

```
# command-packages — Rust
inherited middleware: "hello world!"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [zx](https://github.com/google/zx)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [execa](https://github.com/sindresorhus/execa)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — No validated command package, inheritance, middleware, or registry search API.

---

[← All features](../README.md)
