# Environment built-ins

cd, pwd, env, which and exit affect the command they run in, not the host process.

**Category:** Built-in commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `$`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/builtin-environment.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/builtin-environment.mjs)

```js
// Environment built-ins: pwd, cd, env, which, sleep, exit.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import path from 'path';

await example(
  { id: 'builtin-environment', title: 'Environment built-ins' },
  async ({ record }) => {
    const dir = makeTempDir('env');
    const $q = $({ mirror: false });

    record(
      'pwd inside a chosen directory',
      (await $({ mirror: false, cwd: dir })`pwd`).stdout
    );

    // cd changes the working directory of the process, and is remembered by the
    // following commands.
    const before = (await $q`pwd`).stdout.trim();
    await $q`cd ${dir}`;
    record('pwd after cd', (await $q`pwd`).stdout);
    await $q`cd ${before}`;
    record('back in the original directory', (await $q`pwd`).stdout);

    const withEnv = await $({ mirror: false, env: { DEMO: 'value' } })`env`;
    record('env lists the variables', withEnv.stdout);

    record('which finds a binary', (await $q`which sh`).code);

    const started = Date.now();
    await $q`sleep 0.1`;
    record('sleep waited', Date.now() - started >= 90);
  }
);
```

### Output

Identical in Node.js and Bun:

```
# builtin-environment — Environment built-ins
pwd inside a chosen directory: "<env-dir>\n"
pwd after cd: "<cwd>\n"
back in the original directory: "<cwd>\n"
env lists the variables: "DEMO=value\n"
which finds a binary: 0
sleep waited: true
```

## Rust

**API:** `pwd`, `cd`, `env`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn builtin_environment() -> ExampleResult {
    let mut env = HashMap::new();
    env.insert("COMMAND_STREAM_DEMO".to_string(), "visible".to_string());
    let result = exec(
        "env",
        RunOptions {
            mirror: false,
            env: Some(env),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![observation(
        "configured environment visible",
        result.stdout.contains("COMMAND_STREAM_DEMO=visible"),
    )])
}
```

### Output

```
# builtin-environment — Rust
configured environment visible: true
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
await $`cd /tmp && pwd`.text(); // cd is scoped to the command
```

### [zx](https://github.com/google/zx)

```js
cd('/tmp'); // changes the directory for every later command
```

### [execa](https://github.com/sindresorhus/execa)

```js
execa({ cwd: '/tmp' })`pwd`; // an option, not a command
```

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.cd('/tmp');
shell.pwd(); // changes the process working directory
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('pwd', [], { cwd: '/tmp' });
```

---

[← All features](../README.md)
