# Fire-and-forget background commands

`spawnDetached()` (or `$({ detached: true })`) starts a command in its own session with ignored stdio and resolves with its pid without waiting for it.

**Category:** Running commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `spawnDetached`, `detached`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/detached.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/detached.mjs)

```js
// spawnDetached() starts a command that outlives the caller and returns its pid.
import fs from 'fs';
import path from 'path';
import { spawnDetached } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';

await example(
  { id: 'detached', title: 'Fire-and-forget background commands' },
  async ({ record }) => {
    const dir = makeTempDir('detached');
    const marker = path.join(dir, 'done.txt');

    // Resolves as soon as the process has spawned; it is not awaited.
    const { pid } = await spawnDetached(
      'sleep 0.2 && echo finished > done.txt',
      {
        cwd: dir,
      }
    );
    record('pid is a number', Number.isInteger(pid) && pid > 0);
    record('still running when spawnDetached resolves', !fs.existsSync(marker));

    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    record(
      'what the background command wrote',
      fs.readFileSync(marker, 'utf8')
    );
  }
);
```

### Output

Identical in Node.js and Bun:

```
# detached — Fire-and-forget background commands
pid is a number: true
still running when spawnDetached resolves: true
what the background command wrote: "finished\n"
```

## Rust

**API:** `StreamingRunner::detach`, `ProcessRunner::spawn_detached`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn detached() -> ExampleResult {
    let dir = std::env::temp_dir().join(format!("command-stream-detached-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let marker = dir.join("done.txt");

    // Returns as soon as the process has spawned; it is not awaited.
    let pid = StreamingRunner::new("sleep 0.2 && echo finished > done.txt")
        .cwd(&dir)
        .detach()?;
    let running = !marker.exists();

    for _ in 0..100 {
        if marker.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let written = std::fs::read_to_string(&marker)?;
    std::fs::remove_dir_all(&dir)?;
    Ok(vec![
        observation("pid is a number", pid.is_some_and(|pid| pid > 0)),
        observation("still running when detach returns", running),
        observation("what the background command wrote", written),
    ])
}
```

### Output

```
# detached — Rust
pid is a number: true
still running when detach returns: true
what the background command wrote: "finished\n"
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — Bun.$ always waits; Bun.spawn(argv, { detached: true, stdio: ['ignore', 'ignore', 'ignore'] }).unref().

### [zx](https://github.com/google/zx)

Not supported — no detached option; use node:child_process.

### [execa](https://github.com/sindresorhus/execa)

```js
const child = execa({ detached: true, stdio: 'ignore' })`my-server`;
child.unref();
```

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — exec always waits for the command or its callback.

### [node:child_process](https://nodejs.org/api/child_process.html)

```js
spawn('my-server', [], { detached: true, stdio: 'ignore' }).unref();
```

---

[← All features](../README.md)
