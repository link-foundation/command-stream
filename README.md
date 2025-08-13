# command-$tream

$treamable commands executor

A modern $ shell utility library with streaming, async iteration, and EventEmitter support, optimized for Bun runtime.

## Features

- 🐚 **Shell-like by Default**: Commands behave exactly like running in terminal (stdout→stdout, stderr→stderr, stdin→stdin)
- 🎛️ **Fully Controllable**: Override default behavior with options (`mirror`, `capture`, `stdin`)
- 🚀 **Multiple Usage Patterns**: Classic await, async iteration, EventEmitter, and mixed patterns
- 📡 **Real-time Streaming**: Process command output as it arrives, not after completion
- 🔄 **Bun Optimized**: Designed for Bun runtime with Node.js compatibility
- ⚡ **Performance**: Memory-efficient streaming prevents large buffer accumulation
- 🎯 **Backward Compatible**: Existing `await $` syntax continues to work
- 🛡️ **Type Safe**: Full TypeScript support (coming soon)

## Comparison with Other Libraries

| Feature | [command-stream](https://github.com/link-foundation/command-stream) | [Bun.$](https://bun.sh/docs/runtime/shell) | [execa](https://github.com/sindresorhus/execa) | [zx](https://github.com/google/zx) |
|---------|----------------|-------|-------|-----|
| **Runtime Support** | ✅ Bun + Node.js | 🟡 Bun only | ✅ Node.js | ✅ Node.js |
| **Template Literals** | ✅ `` $`cmd` `` | ✅ `` $`cmd` `` | ✅ `` $`cmd` `` | ✅ `` $`cmd` `` |
| **Real-time Streaming** | ✅ Live output | ❌ Buffer only | 🟡 Limited | ❌ Buffer only |
| **Synchronous Execution** | ✅ `.sync()` with events | ❌ No | ✅ `execaSync` | ❌ No |
| **Async Iteration** | ✅ `for await (chunk of $.stream())` | ❌ No | ❌ No | ❌ No |
| **EventEmitter Pattern** | ✅ `.on('data', ...)` | ❌ No | 🟡 Limited events | ❌ No |
| **Mixed Patterns** | ✅ Events + await/sync | ❌ No | ❌ No | ❌ No |
| **Shell Injection Protection** | ✅ Auto-quoting | ✅ Built-in | ✅ Safe by default | ✅ Safe by default |
| **Cross-platform** | ✅ macOS/Linux/Windows | ✅ Yes | ✅ Yes | ✅ Yes |
| **Performance** | ⚡ Fast (Bun optimized) | ⚡ Very fast | 🐌 Moderate | 🐌 Slow |
| **Memory Efficiency** | ✅ Streaming prevents buildup | 🟡 Buffers in memory | 🟡 Buffers in memory | 🟡 Buffers in memory |
| **Error Handling** | ✅ Configurable (`set -e`/`set +e`, non-zero OK by default) | ✅ Throws on error | ✅ Throws on error | ✅ Throws on error |
| **Shell Settings** | ✅ `set -e`/`set +e` equivalent | ❌ No | ❌ No | ❌ No |
| **Stdout Support** | ✅ Real-time streaming + events | ✅ Shell redirection + buffered | ✅ Node.js streams + interleaved | ✅ Readable streams + `.pipe.stdout` |
| **Stderr Support** | ✅ Real-time streaming + events | ✅ Redirection + `.quiet()` access | ✅ Streams + interleaved output | ✅ Readable streams + `.pipe.stderr` |
| **Stdin Support** | ✅ string/Buffer/inherit/ignore | ✅ Pipe operations | ✅ Input/output streams | ✅ Basic stdin |
| **Built-in Commands** | ❌ Uses system | ✅ echo, cd, etc. | ❌ Uses system | ❌ Uses system |
| **Bundle Size** | 📦 ~15KB | 🎯 0KB (built-in) | 📦 ~25KB | 📦 ~50KB |
| **TypeScript** | 🔄 Coming soon | ✅ Built-in | ✅ Full support | ✅ Full support |
| **License** | ✅ **Unlicense (Public Domain)** | 🟡 MIT (+ LGPL dependencies) | 🟡 MIT | 🟡 Apache 2.0 |

### Why Choose command-stream?

- **🆓 Truly Free**: **Unlicense (Public Domain)** - No restrictions, no attribution required, use however you want
- **🚀 Real-time Processing**: Only library with true streaming and async iteration
- **🔄 Flexible Patterns**: Multiple usage patterns (await, events, iteration, mixed)
- **🐚 Shell Replacement**: Dynamic error handling with `set -e`/`set +e` equivalents for .sh file replacement
- **⚡ Bun Optimized**: Designed for Bun with Node.js fallback compatibility  
- **💾 Memory Efficient**: Streaming prevents large buffer accumulation
- **🛡️ Production Ready**: 200+ tests with comprehensive coverage

## Installation

```bash
# Using npm
npm install command-stream

# Using bun
bun add command-stream
```

## Usage Patterns

### Classic Await (Backward Compatible)

```javascript
import { $ } from 'command-stream';

const result = await $`ls -la`;
console.log(result.stdout);
console.log(result.code); // exit code
```

### Synchronous Execution

```javascript
import { $ } from 'command-stream';

// Use .sync() for blocking execution
const result = $`echo "hello"`.sync();
console.log(result.stdout); // "hello\n"

// Events still work but are batched after completion
$`echo "world"`
  .on('end', result => console.log('Done:', result))
  .sync();
```

### Async Iteration (Real-time Streaming)

```javascript
import { $ } from 'command-stream';

for await (const chunk of $`long-running-command`.stream()) {
  if (chunk.type === 'stdout') {
    console.log('Real-time output:', chunk.data.toString());
  }
}
```

### EventEmitter Pattern (Event-driven)

```javascript
import { $ } from 'command-stream';

$`command`
  .on('data', chunk => {
    if (chunk.type === 'stdout') {
      console.log('Stdout:', chunk.data.toString());
    }
  })
  .on('stderr', chunk => console.log('Stderr:', chunk))
  .on('end', result => console.log('Done:', result))
  .on('exit', code => console.log('Exit code:', code));
```

### Mixed Pattern (Best of Both Worlds)

```javascript
import { $ } from 'command-stream';

// Async mode - events fire in real-time
const process = $`streaming-command`;
process.on('data', chunk => {
  processRealTimeData(chunk);
});
const result = await process;
console.log('Final output:', result.stdout);

// Sync mode - events fire after completion (batched)
const syncCmd = $`another-command`;
syncCmd.on('end', result => {
  console.log('Completed with:', result.stdout);
});
const syncResult = syncCmd.sync();
```

### Shell Replacement (.sh → .mjs)

Replace bash scripts with JavaScript while keeping shell semantics:

```javascript
import { $, shell, set, unset } from 'command-stream';

// set -e equivalent: exit on any error
shell.errexit(true);

await $`mkdir -p build`;
await $`npm run build`;

// set +e equivalent: allow errors (like bash)
shell.errexit(false);
const cleanup = await $`rm -rf temp`; // Won't throw if fails

// set -e again for critical operations  
shell.errexit(true);
await $`cp -r build/* deploy/`;

// Other bash-like settings
shell.verbose(true);  // set -v: print commands
shell.xtrace(true);   // set -x: trace execution

// Or use the bash-style API
set('e');    // set -e
unset('e');  // set +e
set('x');    // set -x
set('verbose'); // Long form also supported
```

## Default Behavior: Shell-like with Programmatic Control

**command-stream behaves exactly like running commands in your shell by default:**

```javascript
import { $ } from 'command-stream';

// This command will:
// 1. Print "Hello" to your terminal (stdout→stdout)
// 2. Print "Error!" to your terminal (stderr→stderr) 
// 3. Capture both outputs for programmatic access
const result = await $`sh -c "echo 'Hello'; echo 'Error!' >&2"`;

console.log('Captured stdout:', result.stdout); // "Hello\n"
console.log('Captured stderr:', result.stderr); // "Error!\n"
console.log('Exit code:', result.code);         // 0
```

**Key Default Options:**
- `mirror: true` - Live output to terminal (like shell)
- `capture: true` - Capture output for later use (unlike shell)
- `stdin: 'inherit'` - Inherit stdin from parent process

**Fully Controllable:**
```javascript
import { $, create, sh } from 'command-stream';

// Disable terminal output but still capture
const result = await sh('echo "silent"', { mirror: false });

// Custom stdin input  
const custom = await sh('cat', { stdin: "custom input" });

// Create custom $ with different defaults
const quiet$ = create({ mirror: false });
await quiet$`echo "silent"`; // Won't print to terminal

// Disable both mirroring and capturing for performance
await sh('make build', { mirror: false, capture: false });
```

**This gives you the best of both worlds:** shell-like behavior by default, but with full programmatic control and real-time streaming capabilities.

## Real-world Examples

### Log File Streaming with Session ID Extraction

```javascript
import { $ } from 'command-stream';
import { appendFileSync, writeFileSync } from 'fs';

let sessionId = null;
let logFile = null;

for await (const chunk of $`your-streaming-command`.stream()) {
  if (chunk.type === 'stdout') {
    const data = chunk.data.toString();
    
    // Extract session ID from output
    if (!sessionId && data.includes('session_id')) {
      try {
        const parsed = JSON.parse(data);
        sessionId = parsed.session_id;
        logFile = `${sessionId}.log`;
        console.log(`Session ID: ${sessionId}`);
      } catch (e) {
        // Handle JSON parse errors
      }
    }
    
    // Write to log file in real-time
    if (logFile) {
      appendFileSync(logFile, data);
    }
  }
}
```

### Progress Monitoring

```javascript
import { $ } from 'command-stream';

let progress = 0;

$`download-large-file`
  .on('stdout', (chunk) => {
    const output = chunk.toString();
    if (output.includes('Progress:')) {
      progress = parseProgress(output);
      updateProgressBar(progress);
    }
  })
  .on('end', (result) => {
    console.log('Download completed!');
  });
```

## API Reference

### ProcessRunner Class

The enhanced `$` function returns a `ProcessRunner` instance that extends `EventEmitter`.

#### Events

- `data`: Emitted for each chunk with `{type: 'stdout'|'stderr', data: Buffer}`
- `stdout`: Emitted for stdout chunks (Buffer)
- `stderr`: Emitted for stderr chunks (Buffer)
- `end`: Emitted when process completes with final result object
- `exit`: Emitted with exit code

#### Methods

- `stream()`: Returns an async iterator for real-time chunk processing
- `sync()`: Execute command synchronously (blocks until completion, events batched)
- `then()`, `catch()`, `finally()`: Promise interface for await support

#### Properties

- `stdout`: Direct access to child process stdout stream
- `stderr`: Direct access to child process stderr stream  
- `stdin`: Direct access to child process stdin stream

### Default Options

**By default, command-stream behaves like running commands in the shell:**

```javascript
{
  mirror: true,    // Live output to terminal (stdout→stdout, stderr→stderr)
  capture: true,   // Capture output for programmatic access
  stdin: 'inherit' // Inherit stdin from parent process
}
```

**Option Details:**
- `mirror: boolean` - Whether to pipe output to terminal in real-time
- `capture: boolean` - Whether to capture output in result object
- `stdin: 'inherit' | 'ignore' | string | Buffer` - How to handle stdin
- `cwd: string` - Working directory for command
- `env: object` - Environment variables

**Override defaults:**
- Use `sh(command, options)` for one-off overrides
- Use `create(defaultOptions)` to create custom `$` with different defaults

### Shell Settings API

Control shell behavior like bash `set`/`unset` commands:

#### Functions

- `shell.errexit(boolean)`: Enable/disable exit-on-error (like `set ±e`)
- `shell.verbose(boolean)`: Enable/disable command printing (like `set ±v`)
- `shell.xtrace(boolean)`: Enable/disable execution tracing (like `set ±x`)
- `set(option)`: Enable shell option (`'e'`, `'v'`, `'x'`, or long names)
- `unset(option)`: Disable shell option
- `shell.settings()`: Get current settings object

#### Supported Options

- `'e'` / `'errexit'`: Exit on command failure
- `'v'` / `'verbose'`: Print commands before execution
- `'x'` / `'xtrace'`: Trace command execution with `+` prefix
- `'u'` / `'nounset'`: Error on undefined variables (planned)
- `'pipefail'`: Pipe failure detection (planned)

### Result Object

```javascript
{
  code: number,        // Exit code
  stdout: string,      // Complete stdout output
  stderr: string,      // Complete stderr output
  stdin: string,       // Input sent to process
  child: ChildProcess  // Original child process object
}
```

## Testing

```bash
# Run comprehensive test suite
bun test

# Run tests with coverage report
bun test --coverage
```

## Requirements

- **Bun**: >= 1.0.0 (primary runtime)
- **Node.js**: >= 20.0.0 (compatibility support)

## License - Our Biggest Advantage

**The Unlicense (Public Domain)**

Unlike other shell utilities that require attribution (MIT, Apache 2.0), command-stream is released into the **public domain**. This means:

- ✅ **No attribution required** - Use it without crediting anyone
- ✅ **No license files to include** - Simplify your distribution
- ✅ **No restrictions** - Modify, sell, embed, whatever you want
- ✅ **No legal concerns** - It's as free as code can be
- ✅ **Corporate friendly** - No license compliance overhead

This makes command-stream ideal for:
- **Commercial products** where license attribution is inconvenient
- **Embedded systems** where every byte counts
- **Educational materials** that can be freely shared
- **Internal tools** without legal review requirements

> "This is free and unencumbered software released into the public domain."
