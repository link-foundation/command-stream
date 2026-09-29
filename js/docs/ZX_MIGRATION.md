# Migrating from zx

command-stream ships a zx-compatible layer, so a zx script keeps working after
a one-line change. Its behaviour follows zx 8.9: the same quoting, the same
`ProcessPromise`/`ProcessOutput` API and the same helpers. Once a script runs,
you can adopt command-stream features one call at a time.

## One-line migrations

| zx                                  | command-stream                                                   |
| ----------------------------------- | ---------------------------------------------------------------- |
| `import { $, cd, fs } from 'zx'`    | `import { $, cd, fs } from 'command-stream/zx'`                  |
| `import { $ } from 'zx/core'`       | `import { $ } from 'command-stream/zx/core'`                     |
| `import 'zx/globals'`               | `import 'command-stream/zx/globals'`                             |
| `const { $ } = require('zx')`       | `const { $ } = require('command-stream/zx')`                     |
| `#!/usr/bin/env zx`                 | `#!/usr/bin/env command-stream`                                  |
| `zx script.mjs --flag`              | `command-stream script.mjs --flag` (or `npx command-stream ...`) |
| ``zx --eval 'await $`ls`'``         | ``command-stream --eval 'await $`ls`'``                          |
| zx `$` inside a command-stream file | `import { $ } from 'command-stream'`, then `` $.zx`...` ``       |

`$.zx` is the zx `$` itself (`$.zx === require('command-stream/zx').$`), so
`` $.zx({ nothrow: true })`...` ``, `$.zx.sync`, `$.zx.cwd = ...` and every
other zx option work on it. It is loaded on first use, so code that never
touches `$.zx` does not load the zx layer.

The `command-stream` executable accepts the zx CLI flags (`--quiet`,
`--verbose`, `--shell`, `--prefix`, `--postfix`, `--prefer-local`, `--cwd`,
`--eval`, `--ext`, `--install`, `--registry`, `--repl`, `--env`) and runs
JavaScript and Markdown scripts, TypeScript where the runtime can execute it,
remote scripts and scripts piped on stdin. Scripts get the zx globals (`$`, `cd`, `within`, `fs`, `glob`, `echo`,
`question`, `sleep`, `retry`, `spinner`, `argv`, ...) without imports:

```js
#!/usr/bin/env command-stream

const branch = await $`git branch --show-current`;
echo(`deploying ${branch}`);
cd('/tmp');
echo(await $`pwd`);
```

## What is covered

- **JavaScript:** all 291 units of zx's test suite (287 test registrations
  and 4 files without one) are ported individually to `js/tests/zx/` and run
  against `command-stream/zx`. Each test title carries its upstream ID, and the
  `zx-compatible-api` case of `bun run test:competitors` fails if any unit
  loses its port. See the
  [competitor test audit](COMPETITOR_TEST_AUDIT.md#zx-compatible-layer).
- **Runtimes and platforms:** CI runs the ports with Bun on Linux, macOS and
  Windows, and with Node.js 20, 22 and 24 on Linux. The JSR artifact test
  uses Deno.
- **Rust:** the `command_stream::zx` module (`zx!`, `Shell`,
  `ProcessPromise`, `ProcessOutput`, `within`, `cd`, `retry`, `spinner`,
  `parse_argv`, ...) ports the applicable units in `rust/tests/zx_*.rs`:

  ```rust
  use command_stream::zx;

  let out = zx!("echo {}", "hello world").await?;
  assert_eq!(out.stdout, "hello world\n");
  let failed = zx!(zx::Shell::new().nothrow(true), "exit 3").await?;
  assert_eq!(failed.exit_code, Some(3));
  ```

## Known differences

- `version` and `--version` report the zx release the layer follows (for
  example `8.9.0`); `--help` shows both versions, as in
  `command-stream 1.2.0 (zx 8.9.0 compatible)`.
- Bun does not implement `async_hooks.createHook`, so `syncProcessCwd()` has
  no effect there: a `cd()` inside `within()` also changes `process.cwd()` for
  code running outside it. The corresponding test is skipped on Bun only.
- Like zx, the zx layer runs commands through a real shell (bash by default,
  or `usePowerShell()`/`usePwsh()`). On Windows it needs bash (for example Git
  Bash) or one of those switches. The core `$` has built-in commands and does
  not need bash (see below).
- `--install` installs missing dependencies with `npm`, as zx does.

## What you gain

The zx layer is the entry point. The core `$` from `command-stream` adds:

- **Project-local executables.** Pass `{ cwd: project, preferLocal: true }` to
  the default `$` or `run()` to search `project/node_modules/.bin` before
  `PATH`. `preferLocal` also accepts a directory or an ordered directory
  array. The default runner and zx use the same local-bin resolver, so this
  capability is available without switching to `$.zx`. Rust's default
  `RunOptions { prefer_local: PreferLocal::Cwd, .. }`, `StreamingRunner`, and
  `zx::Shell` likewise share the resolver. `$.bun.preferLocal()` and Rust's
  `bun_shell::Shell` use it as well.
- **Built-in commands.** `cat`, `ls`, `mkdir`, `rm`, `mv`, `cp`, `touch`,
  `basename`, `dirname`, `seq`, `tee`, `yes`, `cd`, `pwd`, `echo`, `sleep`,
  `true`, `false`, `which`, `exit`, `env` and `test` run in-process, so the same
  script works on Windows without coreutils.
- **Virtual commands.** `register('name', handler)` turns a JavaScript
  function into a command that can sit anywhere in a shell pipeline:
  `` $`echo b a | shout | sort` ``.
- **Typed streaming.** ``for await (const chunk of $`cmd`.stream())``
  yields `stdout`, `stderr` and `exit` chunks in one loop, in arrival order. zx
  iterates stdout lines only.
- **Events and mixed patterns.** `.on('data' | 'stdout' | 'stderr' | 'end')`
  can run alongside `await` on the same command.
- **Shell settings.** `set -e`/`set +e`, `pipefail` and friends for
  translating `.sh` files.

[`examples/zx-beyond.mjs`](../examples/zx-beyond.mjs) runs a zx snippet and
each of these features in one file.

## Size

Measured with `bun benchmarks/cli.mjs --suite bundle-size` (esbuild,
minified, Node platform, zx 8.8.5 from npm):

| Import                                       | Minified bundle |
| -------------------------------------------- | --------------: |
| `import * as api from 'zx'`                  |          411 KB |
| `import { $ } from 'zx'`                     |          411 KB |
| `import * as api from 'command-stream/zx'`   |          129 KB |
| `import { $ } from 'command-stream/zx/core'` |           37 KB |

The zx layer has no third-party dependencies. The full `command-stream` entry
bundles more than the zx layer because it includes terminal capture; see
[benchmarks/README.md](../benchmarks/README.md) for package, install and
import-memory numbers.
