# Function and builder APIs

Commands can also be built from plain strings instead of template literals.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `sh`, `exec`, `run`, `create`, `shell`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/function-api.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/function-api.mjs)

```js
// Besides the template tag there are plain functions: sh, exec, run and create.
import { $, sh, exec, run, create } from '../../src/$.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'function-api', title: 'sh(), exec(), run() and create()' },
  async ({ record }) => {
    record('sh(command)', (await sh('echo from-sh', { mirror: false })).stdout);
    record(
      'exec(file, args)',
      (await exec('echo', ['from-exec'], { mirror: false })).stdout
    );
    record('run(command)', (await run('echo from-run')).stdout);

    // create() returns a $ with preset options.
    const $quiet = create({ mirror: false, capture: true });
    record('create(options)', (await $quiet`echo from-create`).stdout);

    // $ itself can be called with options for the same effect.
    record('$(options)', (await $({ mirror: false })`echo from-dollar`).stdout);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# function-api — sh(), exec(), run() and create()
sh(command): "from-sh\n"
exec(file, args): "from-exec\n"
run(command): "from-run\n"
create(options): "from-create\n"
$(options): "from-dollar\n"
```

## Rust

**API:** `run`, `exec`, `create`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn function_api() -> ExampleResult {
    let simple = run("echo run").await?;
    let configured = exec("echo exec", quiet_options()).await?;
    let mut runner = create("echo create", quiet_options());
    let created = runner.run().await?;
    Ok(vec![observation(
        "run, exec and create",
        [
            simple.stdout.trim(),
            configured.stdout.trim(),
            created.stdout.trim(),
        ],
    )])
}
```

### Output

```
# function-api — Rust
run, exec and create: ["run","exec","create"]
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun.$ only accepts a tagged template; a string has to be turned back into one by hand.

### [zx](https://github.com/google/zx)

```js
await $({ input: '' })`sh -c ${'echo hi'}`; // or build a template array manually
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa('echo', ['hi']); // the classic function form
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.exec('echo hi'); // strings are the only form
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('echo', ['hi']);
```

---

[← All features](../README.md)
