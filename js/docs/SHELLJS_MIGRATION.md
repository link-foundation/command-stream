# Migrating from ShellJS

JavaScript exposes the **pinned ShellJS 0.10.0 API** at `command-stream/shelljs`,
`$.shelljs` and the named `shelljs` export. All three share one implementation,
configuration, environment, error state and directory stack. This boundary uses
ShellJS itself, as the Execa boundary uses Execa; it preserves behavior that an
argument-joining wrapper cannot reproduce. The native command-stream API offers
streaming, events, cancellation and custom virtual commands alongside it.

The compatibility import installs a guard on ShellJS's resolved `fast-glob`
synchronous entry points (`sync` and `globSync`), including any callers sharing
that dependency instance. Patterns and ignore patterns are limited to 10,000
characters and 100 combined brace/parenthesis nesting levels before parsing.
Ordinary brace expansion remains available; ShellJS retains its usual literal
fallback when argument expansion fails. Direct recursive glob calls can throw a
`SyntaxError` for excessive nesting. Configuration resets cannot disable this
guard. It mitigates [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
which currently has no patched release. Direct imports of `braces` and
`fast-glob`'s asynchronous entry points are outside this boundary.

Rust exposes `command_stream::shelljs::ShellJs`: asynchronous command calls,
configuration, file operations and an isolated directory stack. See the limits
below when translating JavaScript-specific behavior.

## Imports and results

```javascript
// Before
import shell from 'shelljs';
const first = shell.head({ '-n': 2 }, ['file with spaces.txt']);
```

```javascript
// After: synchronous ShellJS semantics remain available
import shell from 'command-stream/shelljs';
const migratedFirst = shell.head({ '-n': 2 }, ['file with spaces.txt']);
console.log(migratedFirst.stdout, migratedFirst.stderr, migratedFirst.code);

// The general API exposes the same ShellJS object
import { $, shelljs } from 'command-stream';
console.log($.shelljs === shelljs); // true
const awaitedFirst = await shelljs.head('-n', '2', 'file with spaces.txt');
```

`await` also works with synchronous results. Native JavaScript commands return
captured streams: use `result.stdout.toString()` or `await command.text()`.
ShellJS returns strings/arrays with `code`, `stdout`, `stderr` and pipe methods.
`which()` returns null on failure, `test()` returns a boolean, and `ls()`/`find()`
return arrays. These return types are preserved by the JavaScript adapter.

```rust
use command_stream::shelljs::ShellJs;

let mut shell = ShellJs::new();
shell.config.silent = true;
let result = shell.head(&["-n", "2", "file with spaces.txt"]).await?;
println!("{} {} {}", result.stdout, result.stderr, result.code);
```

Rust command methods take a slice of argument strings and return
`Result<CommandResult>`; `test()` returns `Result<bool>`. Nonzero command statuses
remain results unless `config.fatal` is true. Errors creating an external process
still return `Err`. Keep arguments separate; never join values into shell syntax.

## Every ShellJS command and helper

The JavaScript column is executable with the compatibility import above.
Replace `await shell.method(...)` with the Rust call in the last column when
porting a script. File examples assume the indicated fixture files exist.

| ShellJS API    | JavaScript migration example                 | Rust counterpart                                    |
| -------------- | -------------------------------------------- | --------------------------------------------------- |
| `cat`          | `shell.cat(['a.txt', 'b.txt'])`              | `shell.cat(&["a.txt", "b.txt"]).await?`             |
| `cd`           | `shell.cd('work')`                           | `shell.cd(&["work"]).await?`                        |
| `chmod`        | `shell.chmod('755', 'script')`               | `shell.chmod(&["755", "script"]).await?`            |
| `cmd`          | `shell.cmd('git', 'status', '--short')`      | `shell.cmd("git", &["status", "--short"]).await?`   |
| `cp`           | `shell.cp('-R', 'src', 'copy')`              | `shell.cp(&["-R", "src", "copy"]).await?`           |
| `dirs`         | `shell.dirs()`                               | `shell.dirs()`                                      |
| `echo`         | `shell.echo('hello', 'two words')`           | `shell.echo(&["hello", "two words"]).await?`        |
| `exec`         | `shell.exec('git status', { silent: true })` | `shell.exec("git status").await?`                   |
| `exit`         | `shell.exit(1)`                              | `std::process::exit(1)` (explicit host termination) |
| `find`         | `shell.find('src')`                          | `shell.find(&["src"]).await?`                       |
| `grep`         | `shell.grep('-in', 'warning', 'log')`        | `shell.grep(&["-in", "warning", "log"]).await?`     |
| `head`         | `shell.head({ '-n': 5 }, 'log')`             | `shell.head(&["-n", "5", "log"]).await?`            |
| `ln`           | `shell.ln('-s', 'source', 'link')`           | `shell.ln(&["-s", "source", "link"]).await?`        |
| `ls`           | `shell.ls('-a', 'src')`                      | `shell.ls(&["-a", "src"]).await?`                   |
| `mkdir`        | `shell.mkdir('-p', 'build/output')`          | `shell.mkdir(&["-p", "build/output"]).await?`       |
| `mv`           | `shell.mv('old', 'new')`                     | `shell.mv(&["old", "new"]).await?`                  |
| `popd`         | `shell.popd()`                               | `shell.popd().await?`                               |
| `pushd`        | `shell.pushd('work')`                        | `shell.pushd(&["work"]).await?`                     |
| `pwd`          | `shell.pwd()`                                | `shell.pwd(&[]).await?`                             |
| `rm`           | `shell.rm('-rf', 'build')`                   | `shell.rm(&["-rf", "build"]).await?`                |
| `sed`          | `shell.sed('-i', 'old', 'new', 'file')`      | `shell.sed(&["-i", "old", "new", "file"]).await?`   |
| `set`          | `shell.set('-e')`                            | `shell.set("-e")?`                                  |
| `sort`         | `shell.sort('-rn', 'numbers')`               | `shell.sort(&["-rn", "numbers"]).await?`            |
| `tail`         | `shell.tail({ '-n': 5 }, 'log')`             | `shell.tail(&["-n", "5", "log"]).await?`            |
| `tempdir`      | `shell.tempdir()`                            | `shell.tempdir()`                                   |
| `test`         | `shell.test('-f', 'file')`                   | `shell.test(&["-f", "file"]).await?`                |
| `touch`        | `shell.touch('file')`                        | `shell.touch(&["file"]).await?`                     |
| `uniq`         | `shell.uniq('-c', 'sorted')`                 | `shell.uniq(&["-c", "sorted"]).await?`              |
| `which`        | `shell.which('git')`                         | `shell.which(&["git"]).await?`                      |
| `ShellString`  | `shell.ShellString('hello\n')`               | `CommandResult::success("hello\n")`                 |
| `to`           | `shell.ShellString('hello\n').to('out')`     | `shell.to(&result, "out", false).await?`            |
| `toEnd`        | `shell.ShellString('more\n').toEnd('out')`   | `shell.to(&result, "out", true).await?`             |
| `error`        | `shell.error()`                              | `shell.error()`                                     |
| `errorCode`    | `shell.errorCode()`                          | `shell.error_code()`                                |
| `env`          | `shell.env['BUILD'] = '1'`                   | `shell.env.insert("BUILD".into(), "1".into())`      |
| `config`       | `shell.config.silent = true`                 | `shell.config.silent = true`                        |
| `config.reset` | `shell.config.reset()`                       | `shell.config = Default::default()`                 |

Runnable examples: [JavaScript](../examples/shelljs-migration.mjs) and
[Rust](../../rust/examples/shelljs_migration.rs).
The upstream [ShellJS 0.10.0 reference](https://github.com/shelljs/shelljs/tree/v0.10.0)
is the authority for JavaScript semantics.

## Native text commands

Both native implementations now register **26 built-ins**, including these four:

```javascript
const quiet = $({ mirror: false });
await quiet`head -n 5 log.txt`;
await quiet`tail -5 log.txt`;
await quiet`sort -rnu numbers.txt`;
await quiet`sort log.txt | uniq -cd`;
```

| Command | Supported native options                                            | Input/output behavior                                                                                                                                              |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `head`  | `-n N`, `-nN`, `-N`, `--lines N`, `--lines=N`                       | Stops after N lines; file output is incremental.                                                                                                                   |
| `tail`  | Same count options as head                                          | Reads to EOF; retains at most N lines before output.                                                                                                               |
| `sort`  | `-r`, `-n`, `-u`, combinations and corresponding long options       | Buffers all lines; sorts by UTF-8 bytes, independent of locale. Numeric sorting uses a signed decimal prefix, nonnumeric values as zero, and lexical tie-breaking. |
| `uniq`  | `-c`, `-d`, `-u`, `-i`, combinations and corresponding long options | Keeps one consecutive group; emits it on the next distinct line or EOF. Counting composes with selection. Optional second operand writes an output file.           |

All four accept `--` to end options and `-` as stdin. No file means stdin.
Head/tail counts are nonnegative safe integers; zero prints no lines. Missing,
negative, fractional, unsafe and malformed counts fail with code 1. Negative
counts, byte counts and `tail -f` are outside the native subset. Head/tail/uniq
preserve LF, CRLF and final unterminated lines; sort terminates each output line.
Multiple head/tail files have headers. `uniq -d -u` is rejected. Errors and
cancellation propagate through the native runner; traces are off by default and
can be enabled through the existing tracing options.

## Streaming, buffering and extensions

ShellJS-compatible calls preserve ShellJS buffering and synchronous behavior.
Use the native API when processing output before a system command completes:

```javascript
const command = $({ capture: false, mirror: false })`git log --oneline`;
for await (const chunk of command.stream()) {
  if (chunk.type === 'stdout') process.stdout.write(chunk.data);
}
```

Native file-based head and uniq yield incremental chunks. Tail needs EOF;
sort needs all lines. The current virtual command context supplies stdin as a
completed string, so feeding a live system producer into a virtual text command
still buffers that input. Rust's native command functions support progressive
output through `CommandContext::output_tx`; their returned `CommandResult`
retains the output. Use `StreamingRunner` for external streaming without
retaining the complete result. These boundaries matter for large data.

JavaScript `streams.stdin` starts a real process with a writable input pipe.
For a built-in name, this mode uses the installed system command and its flags;
the public runner owns its streams, PID and cancellation. Pass completed input
with the `stdin` option or use a virtual pipeline to run the native handler.

Register an application-specific transform without installing a shell program:

```javascript
import { register, unregister } from 'command-stream';
register('warnings', ({ stdin }) => ({
  code: 0,
  stdout: stdin
    .split('\n')
    .filter((line) => line.includes('WARN'))
    .join('\n'),
  stderr: '',
}));
try {
  await quiet`cat log.txt | warnings | sort | uniq -c`;
} finally {
  unregister('warnings');
}
```

Rust can register a handler with `VirtualCommandRegistry::register`, or process
`CommandContext` directly. ShellJS also has a plugin API; command-stream's
native registry adds async handlers, async generators/output channels and mixed
virtual/system pipelines. The JavaScript compatibility API keeps ShellJS's own
plugin behavior; registering a native command does not alter ShellJS.

## Rust translation limits

Rust is a portable counterpart, not an interpreter for JavaScript callbacks or
objects. `head`/`tail` take native count options; sort uses the native byte-order
rules. Results are text rather than ShellString arrays or rich `ls('-l')`
objects, and pipe methods become native `Pipeline`/command composition.

Rust grep supports string regexes with `-i`, `-v`, `-n`, `-l`; sed supports
Rust regex syntax and `$1` replacements with `-i` and `-g`. JavaScript RegExp,
replacement callbacks, grep's additional ShellJS flags, cat line numbering,
full ShellJS glob configuration and directory-stack index flags require explicit
translation. chmod accepts octal modes and optional `-R`; symbolic modes and
verbose flags are outside this subset. Windows permissions and symlink creation
follow the host filesystem rules. Native filesystem commands retain their
existing documented option subsets. Use `cmd()` for installed utilities when
additional behavior is needed. `exit()` is an explicit Rust host operation.

Rust `cd`, `pushd` and `popd` change only the session; JavaScript ShellJS changes
`process.cwd()`. `set` supports fatal, verbose and glob toggles. Rust error state
belongs to its session; JavaScript state belongs to the shared ShellJS singleton.
These differences are intentional and visible in the examples and tests.

## Reproducible performance comparisons

Run the bounded latency probes:

```bash
node js/benchmarks/shelljs-streaming.mjs
cargo run --manifest-path rust/benchmarks/Cargo.toml --bin shelljs_streaming
```

Each produces 8 chunks of 64 KiB, separated by 5 ms, and validates all 524,288
bytes and the exit code. JavaScript compares ShellJS buffering, native buffering
and native streaming using the same child script. Rust compares buffering and
streaming using its own equivalent producer, because ShellJS is a JavaScript
library. Reports include first-byte latency and completion time. Streaming can
expose data earlier; total runtime and memory depend on workload, capture mode
and host. These single-run probes make no universal speed or memory claim.

For repeated throughput measurements, use the existing benchmark harness:

```bash
cd js
bun benchmarks/cli.mjs --suite performance --adapter command-stream,ShellJS --iterations 30 --warmup 5
```

The harness checks results, rotates adapter order and reports statistics. See
[JavaScript benchmarks](../benchmarks/README.md) and
[Rust benchmarks](../../rust/benchmarks/README.md). Native text-command parity
is checked by the shared [conformance corpus](../../conformance/text-commands/cases.json),
plus file, error, pipeline and cancellation tests in both languages.
