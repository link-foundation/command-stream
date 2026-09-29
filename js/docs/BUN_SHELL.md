# Bun Shell (`Bun.$`) on Node.js, Bun and Deno

`command-stream/bun` is the [Bun Shell](https://bun.sh/docs/runtime/shell)
API (`import { $ } from 'bun'`) for every JavaScript runtime. It is a port of
Bun's own shell lexer, parser and interpreter (`js/src/bun-shell/`), not a
wrapper around `sh`. Scripts written for `Bun.$` therefore behave the same on
Node.js, Bun and Deno, on Linux, macOS and Windows. The port depends only on
`node:` built-in modules.

Parity is measured, not claimed. Every upstream Bun Shell test is recorded in a
language-neutral corpus ([`conformance/bun-shell/`](../../conformance/bun-shell/README.md)),
and CI runs the corpus on each runtime and OS
([`bun-shell.yml`](../../.github/workflows/bun-shell.yml)).

- [Migrating from `Bun.$`](#migrating-from-bun)
- [Entry points](#entry-points)
- [API](#api)
- [Shell language and builtins](#shell-language-and-builtins)
- [Cross-runtime guide](#cross-runtime-guide)
- [Beyond `Bun.$`: streaming and virtual commands](#beyond-bun-streaming-and-virtual-commands)
- [Performance](#performance)
- [Conformance](#conformance)
- [Rust](#rust)

## Migrating from `Bun.$`

Change the import:

```diff
-import { $ } from 'bun';
+import { $ } from 'command-stream/bun';
```

Nothing else changes. The template syntax, escaping, `ShellPromise` methods,
`ShellOutput`/`ShellError` fields and error messages all match Bun. The
TypeScript declarations (`types/bun.d.ts`, `types/bun.d.cts`) mirror
`bun-types`. The only Bun-specific values are `Bun.file()`, `Response` and
`Blob`. They still work when the runtime provides them, and `$.file(path)` is
the portable replacement for `Bun.file(path)`.

## Entry points

All of these share one `$` instance:

```javascript
import { $ } from 'command-stream/bun'; // ESM
const { $ } = require('command-stream/bun'); // CommonJS

import { $ as stream } from 'command-stream';
stream.bun; // the same Bun.$-compatible $, from the main entry point
```

On Deno, import through npm: `import { $ } from 'npm:command-stream/bun'`.

## API

```javascript
import { $, ShellError } from 'command-stream/bun';

const name = 'world; rm -rf /'; // interpolations are escaped, never re-parsed
await $`echo Hello ${name}`; // prints "Hello world; rm -rf /"

const text = await $`ls *.md | wc -l`.text();
const pkg = await $`cat package.json`.json();
for await (const line of $`git log --oneline`.lines()) {
  console.log(line);
}

const out = await $`exit 3`.nothrow().quiet();
out.exitCode; // 3

try {
  await $`exit 1`.quiet();
} catch (error) {
  error instanceof ShellError; // true: "Failed with exit code 1"
}
```

| API                                               | Behaviour (as in Bun)                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `` $`...` ``                                      | Parses immediately (syntax errors throw) and runs lazily when awaited. Returns a `ShellPromise`.                      |
| `${value}` interpolation                          | Strings, numbers and bigints are escaped. Arrays expand to several arguments, `{ raw: '...' }` is inserted unescaped. |
| `< ${buffer}`, `> ${buffer}`                      | `Buffer`/typed arrays as stdin, or as a stdout target. `Response`, `Blob` and file references also work.              |
| `.text(encoding?)`, `.json()`, `.lines()`         | Read stdout.                                                                                                          |
| `.arrayBuffer()`, `.bytes()`, `.blob()`           | Read stdout as binary data.                                                                                           |
| `.quiet()`, `.nothrow()`, `.throws(bool)`         | Stop echoing output, and choose whether a non-zero exit rejects.                                                      |
| `.cwd(dir)`, `.env(vars)`                         | Per-command working directory and environment.                                                                        |
| `ShellOutput`                                     | `stdout`, `stderr` (`Buffer`), `exitCode`, `text()`, `json()`, `arrayBuffer()`, `bytes()`, `blob()`.                  |
| `ShellError`                                      | The same fields as `ShellOutput`, plus `message`.                                                                     |
| `$.cwd()`, `$.env()`, `$.nothrow()`, `$.throws()` | Defaults for every later command of this `$`.                                                                         |
| `new $.Shell()`                                   | An independent `$` with its own defaults.                                                                             |
| `$.escape(str)`, `$.braces(pattern)`              | Escape a string for the shell, and expand `{a,b}` patterns.                                                           |
| `$.file(path)`                                    | Portable `Bun.file()`: `exists()`, `text()`, `json()`, `bytes()`, `arrayBuffer()`, `size`. Interpolates as its path.  |

`$.preferLocal()` and ``$`cmd`.preferLocal()`` are command-stream extensions
that search the current project's `node_modules/.bin` before `PATH`. Pass a
directory or an ordered array of directories to search those projects instead.
The default `$`, the zx layer, and the Rust APIs use the same resolver.

## Shell language and builtins

The interpreter implements the Bun Shell language:

- pipelines, `&&`, `||` and `;`;
- subshells `( ... )` and command substitution `$(...)` / `` `...` ``;
- `if`/`elif`/`else`, and `[[ ... ]]` conditions;
- variable assignment (`FOO=bar cmd`, `FOO=bar;`), `$VAR`, and the positionals
  `$0`, `$1`, ...;
- redirects: `>`, `>>`, `<`, `2>`, `&>`, `2>&1` and `1>&2`;
- globs (`*`, `?`, `**`, `[...]`) and brace expansion (`{a,b}`).

Bun Shell is not bash. As in Bun, `$?`, `${VAR}` and `{1..3}` are passed
through literally.

Commands are resolved like in Bun: a builtin first, then a program on `PATH`.
These builtins run in-process and behave identically on every OS, including
Windows:

`echo`, `exit`, `true`, `false`, `pwd`, `cd`, `export`, `which`, `basename`,
`dirname`, `yes`, `seq`, `ls`, `rm`, `mkdir`, `touch`, `mv`, `cat`, `cp`.

As in Bun, `cat` and `cp` are builtins only on Windows. On Linux and macOS
they run the system programs unless
`BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1` is set. Builtin errors and usage
messages are byte-for-byte those of Bun.

## Cross-runtime guide

| Runtime       | Import                                       | Notes                                                                                  |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Node.js >= 20 | `import { $ } from 'command-stream/bun'`     | `require('command-stream/bun')` also works (`require(esm)`: Node.js >= 20.19 / 22.12). |
| Bun           | `import { $ } from 'command-stream/bun'`     | The same script also runs with `import { $ } from 'bun'`.                              |
| Deno 2        | `import { $ } from 'npm:command-stream/bun'` | Needs `-A`, or `--allow-run --allow-read --allow-write --allow-env --allow-sys`.       |

Portable scripts follow two rules:

1. Prefer builtins (`ls`, `rm -rf`, `mkdir -p`, `mv`, `touch`, `which`) over
   system tools. They are the same on Windows, where no POSIX shell exists.
2. Use `$.file(path)` instead of `Bun.file(path)`, and `Buffer`/`Uint8Array`
   for binary stdin and stdout.

Deno's `node:fs` differs from Node's in ways the builtins depend on (for
example, `unlinkSync` removes directories). `js/src/bun-shell/fs.mjs` shims
these differences on Deno only, so `rm dir` fails with "Is a directory" on every
runtime.

[`examples/bun-shell-portable.mjs`](../examples/bun-shell-portable.mjs) runs
unchanged on all three runtimes:

```sh
node js/examples/bun-shell-portable.mjs
bun js/examples/bun-shell-portable.mjs
deno run -A --node-modules-dir=manual --no-lock js/examples/bun-shell-portable.mjs
```

## Beyond `Bun.$`: streaming and virtual commands

`Bun.$` buffers a command's output and returns it when the command finishes.
The main `command-stream` entry point runs the same kind of scripts. It also
provides the following, which `Bun.$` does not:

- **Real-time streaming.** `for await (const chunk of $`cmd`.stream())`,
  `stdout`/`stderr`/`data` events, and `.pipe()`. Output is processed as it
  arrives, and long-running commands do not accumulate memory.
- **Virtual commands.** `register(name, handler)` turns a JavaScript function
  into a command that works in pipelines, next to real programs.
- **Process control.** `.kill()`, `pid`, signals, TTY capture, and a
  synchronous `.sync()` mode.

```javascript
import { $, register } from 'command-stream';

register('shout', async ({ stdin }) => ({
  stdout: String(stdin).toUpperCase(),
  code: 0,
}));

const silent = $({ mirror: false });
for await (const chunk of silent`echo streamed | shout`.stream()) {
  if (chunk.type === 'stdout') {
    console.log(chunk.data.toString()); // "STREAMED"
  }
}

await $.bun`echo Bun.$ semantics from the same import`;
```

Use `command-stream/bun` (or `$.bun`) where `Bun.$` semantics matter. Use `$`
where streaming and virtual commands help. Both are available from the same
package, on every runtime.

## Performance

[`benchmarks/`](../benchmarks/README.md) compares `command-stream/bun` with
`Bun.$` itself under Bun 1.4.2 on Linux (30 iterations; median, then the
ratio to the fastest of the three):

| Scenario      | `command-stream/bun` | `command-stream`  | `Bun.$`           |
| ------------- | -------------------- | ----------------- | ----------------- |
| Spawn latency | 159.44 ms (1.00x)    | 189.77 ms (1.19x) | 198.31 ms (1.24x) |
| Buffered 1 MB | 168.72 ms (1.05x)    | 161.08 ms (1.00x) | 168.57 ms (1.05x) |
| Concurrent 8  | 153.66 ms (1.10x)    | 139.31 ms (1.00x) | 140.20 ms (1.01x) |
| Non-zero exit | 67.90 ms (1.00x)     | 67.62 ms (1.00x)  | 80.79 ms (1.19x)  |

The port stays within 10% of `Bun.$` in every scenario. To reproduce:

```sh
cd js && bun benchmarks/cli.mjs --suite performance --adapter 'Bun.$,command-stream/bun'
```

## Conformance

The [corpus](../../conformance/bun-shell/README.md) has 1256 cases recorded from
every Bun Shell test at a pinned upstream commit, and validated against the
real `Bun.$`. The result on Linux is `1216 passed, 0 failed, 40 skipped`, on
Node.js, Bun and Deno alike. The skipped cases are Windows-only, need a
non-root user, or need a tool that is missing.

```sh
bun conformance/bun-shell/run-bun-reference.mjs   # the oracle: real Bun.$
node conformance/bun-shell/run-js.mjs             # this port on Node.js
bun conformance/bun-shell/run-js.mjs              # ... on Bun
deno run -A conformance/bun-shell/run-js.mjs      # ... on Deno
```

Every runner accepts `--filter <id-substring>`, `--file <case-file>` and
`--verbose`. The JavaScript API surface, which cannot be expressed as data
(`js-api` units), is covered by `tests/bun-shell-api.test.mjs` and
`tests/bun-shell-deno.test.mjs`.

## Rust

The Rust crate ports the same shell as `command_stream::bun_shell`, checked
against the same corpus:

```sh
cd rust && cargo test --test bun_shell_conformance -- --ignored --nocapture
```

The Rust port is in progress. Its glob matcher and walker are complete, and
the interpreter is being ported case by case against the corpus.
