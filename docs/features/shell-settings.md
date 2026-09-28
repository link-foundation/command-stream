# Shell settings

Shell settings model errexit, pipefail, verbose, xtrace and nounset behavior.

**Category:** Shell syntax

**Languages:** JavaScript, Rust

## JavaScript

**API:** `shell`, `set`, `unset`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/shell-settings.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/shell-settings.mjs)

```js
// Shell settings mirror `set -e`, `set -x`, `set -v` and `set -o pipefail`.
import { $, shell, set, unset } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example(
  { id: 'shell-settings', title: 'Shell settings' },
  async ({ record }) => {
    record('defaults', shell.settings());

    set('e');
    record('set("e") enables errexit', shell.settings().errexit);
    try {
      await $q`sh -c 'exit 5'`;
      record('failing command with errexit', 'did not throw');
    } catch (error) {
      record('failing command with errexit', `threw with code ${error.code}`);
    }
    unset('e');

    shell.pipefail(true);
    record(
      'pipefail makes an early failure win',
      (await $q`sh -c 'exit 3' | cat`).code
    );
    shell.pipefail(false);
    record(
      'without pipefail the last stage wins',
      (await $q`sh -c 'exit 3' | cat`).code
    );

    set('x');
    record('xtrace on', shell.settings().xtrace);
    unset('x');
    record('settings restored', shell.settings());
  }
);
```

### Output

Identical in Node.js and Bun:

```
# shell-settings — Shell settings
defaults: {"errexit":false,"verbose":false,"xtrace":false,"pipefail":false,"nounset":false}
set("e") enables errexit: true
failing command with errexit: "threw with code 5"
pipefail makes an early failure win: 3
without pipefail the last stage wins: 0
xtrace on: true
settings restored: {"errexit":false,"verbose":false,"xtrace":false,"pipefail":false,"nounset":false}
```

## Rust

**API:** `ShellSettings`, `set_shell_option`, `unset_shell_option`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn shell_settings() -> ExampleResult {
    set_shell_option("pipefail").await;
    let with_pipefail = Pipeline::new().add("false").add("true").run().await?;
    unset_shell_option("pipefail").await;
    let without_pipefail = Pipeline::new().add("false").add("true").run().await?;
    Ok(vec![
        observation("with pipefail", with_pipefail.code),
        observation("without pipefail", without_pipefail.code),
    ])
}
```

### Output

```
# shell-settings — Rust
with pipefail: 1
without pipefail: 0
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

```js
$.throws(true); // errexit only
```

### [zx](https://github.com/google/zx)

```js
$.verbose = true; // verbose only; the rest belong to the system shell
```

### [execa](https://github.com/sindresorhus/execa)

Not supported — no shell settings; the equivalents are per-command options.

### [ShellJS](https://github.com/shelljs/shelljs)

```js
shell.config.fatal = true;
shell.config.verbose = true; // errexit and verbose
```

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
execFile('sh', ['-c', 'set -eo pipefail; ...']);
```

---

[← All features](../README.md)
