# Migrating from cross-spawn

JavaScript's `$.spawn` and named `spawn` export use `cross-spawn` directly.
They return its native `ChildProcess`, and `spawn.sync` returns its native
`SpawnSyncReturns` result. Existing `cwd`, `env`, `stdio`, `shell`, `signal`,
`timeout`, `input`, and `encoding` options keep their cross-spawn meanings.
Importing the package through CommonJS exposes the same methods:

```js
// Before
const spawn = require('cross-spawn');
const child = spawn('git', ['status', '--short']);

// After, CommonJS
const $ = require('command-stream');
const child = $.spawn('git', ['status', '--short']);

// After, ESM
import $, { spawn } from 'command-stream';
const result = spawn.sync('git', ['status', '--short'], { encoding: 'utf8' });
```

## Ten common use cases

| Use case                                  | JavaScript replacement                                         | Rust equivalent                                              |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Run an executable with exact arguments | `$.spawn(file, args)`                                          | `StreamingRunner::from_argv(file, args).collect().await`     |
| 2. Wait synchronously and capture output  | `$.spawn.sync(file, args, { encoding: 'utf8' })`               | `StreamingRunner::from_argv(file, args).collect_blocking()`  |
| 3. Receive output as it arrives           | `$.spawn(file, args).stdout.on('data', handler)`               | `StreamingRunner::from_argv(file, args).stream()`            |
| 4. Keep stdout and stderr separate        | Read `child.stdout` and `child.stderr`                         | Match `OutputChunk::Stdout` and `OutputChunk::Stderr`        |
| 5. Write to stdin                         | `child.stdin.end(input)`                                       | `StreamingRunner::from_argv(file, args).stdin(input)`        |
| 6. Use another directory                  | `$.spawn(file, args, { cwd })`                                 | `StreamingRunner::from_argv(file, args).cwd(cwd)`            |
| 7. Set environment values                 | `$.spawn(file, args, { env: { ...process.env, KEY: value } })` | `StreamingRunner::from_argv(file, args).env(values)`         |
| 8. Inherit terminal stdio                 | `$.spawn(file, args, { stdio: 'inherit' })`                    | Use Rust's `std::process::Command` with `Stdio::inherit()`   |
| 9. Handle a nonzero exit                  | Listen for `close` and inspect its code; sync: `result.status` | Inspect `CommandResult.code` or `OutputChunk::Exit`          |
| 10. Handle a launch error or stop a child | Listen for `error`; call `child.kill()`                        | `collect().await` returns `Err`; call `OutputStream::kill()` |

These mappings describe the APIs each language actually has. Rust does not
expose JavaScript's `ChildProcess` event object or custom stdio descriptor
arrays. Its `StreamingRunner` provides exact arguments, live output, cwd,
environment, stdin content, process IDs, and termination. The blocking method
must be called outside a Tokio runtime.

## Streaming and buffering

cross-spawn's asynchronous child already provides live Node streams. Its
synchronous call buffers output. `$.spawn` preserves both behaviors.
Command-stream additionally offers an async iterator with typed stdout,
stderr, and exit chunks:

```js
import { ProcessRunner } from 'command-stream';

const runner = new ProcessRunner(
  { mode: 'exec', file: 'git', args: ['log', '--oneline'] },
  { capture: false, mirror: false, stdin: 'ignore' }
);
for await (const chunk of runner.stream()) {
  if (chunk.type === 'stdout') process.stdout.write(chunk.data);
}
```

```rust
use command_stream::{OutputChunk, StreamingRunner};

#[tokio::main]
async fn main() {
    let mut stream = StreamingRunner::from_argv("git", ["log", "--oneline"]).stream();
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Stdout(bytes) = chunk {
            print!("{}", String::from_utf8_lossy(&bytes));
        }
    }
}
```

`$.spawn` runs an OS executable. Virtual commands and built-ins belong to the
tagged template and `ProcessRunner` APIs; a name such as `$.ls` is not an OS
executable.

Run [`cross-spawn-migration-examples.mjs`](../examples/cross-spawn-migration-examples.mjs)
on Bun or Node to see a child stream and an async iterator deliver output
before process exit. The [Rust migration example](../../rust/examples/cross_spawn_migration.rs)
shows the same distinction. The [JavaScript benchmark](../benchmarks/README.md)
measures buffered and streaming modes, process throughput, and package size.
The [Rust benchmark](../../rust/benchmarks/README.md) measures the corresponding
Rust output modes and crate footprint. Read results from the same benchmark
run; neither API is inherently faster or smaller across every workload.
