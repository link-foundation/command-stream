# Pipelines

Commands can be composed into pipelines whose output feeds the next stage.

**Category:** Shell syntax

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`, `ProcessRunner#pipe`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/pipelines.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/pipelines.mjs)

```js
// Pipelines mix built-ins, your own commands and real binaries freely.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'pipelines', title: 'Pipelines' }, async ({ record }) => {
  register('upper', async ({ stdin }) => ({
    stdout: String(stdin ?? '').toUpperCase(),
    code: 0,
  }));

  record('built-in into built-in', (await $q`seq 1 3 | cat`).stdout);
  record('built-in into your command', (await $q`echo hello | upper`).stdout);
  record(
    'your command into a real binary',
    (await $q`echo hello | upper | tr A-Z a-z`).stdout
  );
  record(
    'real binary into your command',
    (await $q`printf 'abc' | upper`).stdout
  );

  // The exit code of a pipeline is the exit code of its last stage.
  record(
    'exit code of the last stage',
    (await $q`echo x | sh -c 'exit 7'`).code
  );
  record(
    'an earlier failure does not change it',
    (await $q`sh -c 'exit 3' | cat`).code
  );

  // The .pipe() method builds the same pipeline from separate commands.
  const piped = await $({ mirror: false })`echo method`.pipe(
    $({ mirror: false })`upper`
  );
  record('.pipe() method', piped.stdout);

  unregister('upper');
});
```

### Output

Identical in Node.js and Bun:

```
# pipelines — Pipelines
built-in into built-in: "1\n2\n3\n"
built-in into your command: "HELLO\n"
your command into a real binary: "hello\n"
real binary into your command: "ABC"
exit code of the last stage: 7
an earlier failure does not change it: 0
.pipe() method: "METHOD\n"
```

## Rust

**API:** `Pipeline`, `PipelineExt`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn pipelines() -> ExampleResult {
    let result = Pipeline::new()
        .add("printf 'hello\\nworld\\n'")
        .add("grep world")
        .mirror_output(false)
        .run()
        .await?;
    Ok(vec![observation("pipeline output", result.stdout)])
}
```

### Output

```
# pipelines — Rust
pipeline output: "world\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`echo hi | tr a-z A-Z`.text();
```

### [zx](https://github.com/google/zx)

```js
await $`echo hi`.pipe($`tr a-z A-Z`);
```

### [execa](https://github.com/sindresorhus/execa)

```js
await execa`echo hi`.pipe`tr a-z A-Z`;
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.echo('hi').exec('tr a-z A-Z');
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
// connect the streams by hand: a.stdout.pipe(b.stdin)
```

---

[← All features](../README.md)
