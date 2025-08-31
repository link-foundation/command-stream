[![Open in Gitpod](https://img.shields.io/badge/Gitpod-ready--to--code-f29718?logo=gitpod)](https://gitpod.io/#https://github.com/link-foundation/command-stream)
[![Open in GitHub Codespaces](https://img.shields.io/badge/GitHub%20Codespaces-Open-181717?logo=github)](https://github.com/codespaces/new?hide_repo_select=true&ref=main&repo=link-foundation/command-stream)

# [command-$tream](https://github.com/link-foundation/command-stream)

$treamable commands executor

A modern $ shell utility library with streaming, async iteration, and EventEmitter support, optimized for Bun runtime.

<img width="2752" height="1344" alt="ray-so-export" src="https://github.com/user-attachments/assets/b1656450-0a2a-43f5-917c-4f15c3ffccaa" />

## Features

- 🐚 **Shell-like by Default**: Commands behave exactly like running in terminal (stdout→stdout, stderr→stderr, stdin→stdin)
- 🎛️ **Fully Controllable**: Override default behavior with options (`mirror`, `capture`, `stdin`)
- 🚀 **Multiple Usage Patterns**: Classic await, async iteration, EventEmitter, .pipe() method, and mixed patterns
- 📡 **Real-time Streaming**: Process command output as it arrives, not after completion
- 🔄 **Bun Optimized**: Designed for Bun runtime with Node.js compatibility
- ⚡ **Performance**: Memory-efficient streaming prevents large buffer accumulation
- 🎯 **Backward Compatible**: Existing `await $` syntax continues to work + Bun.$ `.text()` method
- 🛡️ **Type Safe**: Full TypeScript support (coming soon)
- 🔧 **Built-in Commands**: 18 essential commands work identically across platforms

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
| **Bun.$ Compatibility** | ✅ `.text()` method support | ✅ Native API | ❌ No | ❌ No |
| **Shell Injection Protection** | ✅ Auto-quoting | ✅ Built-in | ✅ Safe by default | ✅ Safe by default |
| **Cross-platform** | ✅ macOS/Linux/Windows | ✅ Yes | ✅ Yes | ✅ Yes |
| **Performance** | ⚡ Fast (Bun optimized) | ⚡ Very fast | 🐌 Moderate | 🐌 Slow |
| **Memory Efficiency** | ✅ Streaming prevents buildup | 🟡 Buffers in memory | 🟡 Buffers in memory | 🟡 Buffers in memory |
| **Error Handling** | ✅ Configurable (`set -e`/`set +e`, non-zero OK by default) | ✅ Throws on error | ✅ Throws on error | ✅ Throws on error |
| **Shell Settings** | ✅ `set -e`/`set +e` equivalent | ❌ No | ❌ No | ❌ No |
| **Stdout Support** | ✅ Real-time streaming + events | ✅ Shell redirection + buffered | ✅ Node.js streams + interleaved | ✅ Readable streams + `.pipe.stdout` |
| **Stderr Support** | ✅ Real-time streaming + events | ✅ Redirection + `.quiet()` access | ✅ Streams + interleaved output | ✅ Readable streams + `.pipe.stderr` |
| **Stdin Support** | ✅ string/Buffer/inherit/ignore | ✅ Pipe operations | ✅ Input/output streams | ✅ Basic stdin |
| **Built-in Commands** | ✅ **18 commands**: cat, ls, mkdir, rm, mv, cp, touch, basename, dirname, seq, yes + all Bun.$ commands | ✅ echo, cd, etc. | ❌ Uses system | ❌ Uses system |
| **Virtual Commands Engine** | ✅ **Revolutionary**: Register JavaScript functions as shell commands with full pipeline support | ❌ No extensibility | ❌ No custom commands | ❌ No custom commands |
| **Pipeline/Piping Support** | ✅ **Advanced**: System + Built-ins + Virtual + Mixed + `.pipe()` method | ✅ Standard shell piping | ✅ Programmatic `.pipe()` + multi-destination | ✅ Shell piping + `.pipe()` method |
| **Bundle Size** | 📦 ~15KB | 🎯 0KB (built-in) | 📦 ~25KB | 📦 ~50KB |
| **TypeScript** | 🔄 Coming soon | ✅ Built-in | ✅ Full support | ✅ Full support |
| **License** | ✅ **Unlicense (Public Domain)** | 🟡 MIT (+ LGPL dependencies) | 🟡 MIT | 🟡 Apache 2.0 |

### Why Choose command-stream?

- **🆓 Truly Free**: **Unlicense (Public Domain)** - No restrictions, no attribution required, use however you want
- **🚀 Revolutionary Virtual Commands**: **World's first** fully customizable virtual commands engine - register JavaScript functions as shell commands!
- **🔗 Advanced Pipeline System**: **Only library** where virtual commands work seamlessly in pipelines with built-ins and system commands
- **🔧 Built-in Commands**: **18 essential commands** work identically across all platforms - no system dependencies!
- **📡 Real-time Processing**: Only library with true streaming and async iteration
- **🔄 Flexible Patterns**: Multiple usage patterns (await, events, iteration, mixed)
- **🐚 Shell Replacement**: Dynamic error handling with `set -e`/`set +e` equivalents for .sh file replacement
- **⚡ Bun Optimized**: Designed for Bun with Node.js fallback compatibility  
- **💾 Memory Efficient**: Streaming prevents large buffer accumulation
- **🛡️ Production Ready**: 266+ tests with comprehensive coverage

## Built-in Commands (🚀 NEW!)

command-stream now includes **18 built-in commands** that work identically to their bash/sh counterparts, providing true cross-platform shell scripting without system dependencies:

### 📁 **File System Commands**
- `cat` - Read and display file contents
- `ls` - List directory contents (supports `-l`, `-a`, `-A`)
- `mkdir` - Create directories (supports `-p` recursive)
- `rm` - Remove files/directories (supports `-r`, `-f`) 
- `mv` - Move/rename files and directories
- `cp` - Copy files/directories (supports `-r` recursive)
- `touch` - Create files or update timestamps

### 🔧 **Utility Commands**  
- `basename` - Extract filename from path
- `dirname` - Extract directory from path
- `seq` - Generate number sequences
- `yes` - Output string repeatedly (streaming)

### ⚡ **System Commands**
- `cd` - Change directory
- `pwd` - Print working directory
- `echo` - Print arguments (supports `-n`)
- `sleep` - Wait for specified time
- `true`/`false` - Success/failure commands
- `which` - Locate commands
- `exit` - Exit with code
- `env` - Print environment variables
- `test` - File condition testing

### ✨ **Key Advantages**

- **🌍 Cross-Platform**: Works identically on Windows, macOS, and Linux
- **🚀 Performance**: No system calls - pure JavaScript execution
- **🔄 Pipeline Support**: All commands work in pipelines and virtual command chains
- **⚙️ Option Aware**: Commands respect `cwd`, `env`, and other options
- **🛡️ Safe by Default**: Proper error handling and safety checks (e.g., `rm` requires `-r` for directories)
- **📝 Bash Compatible**: Error messages and behavior match bash/sh exactly

```javascript
import { $ } from 'command-stream';

// All these work without any system dependencies!
await $`mkdir -p project/src`;
await $`touch project/src/index.js`;
await $`echo "console.log('Hello!');" > project/src/index.js`;
await $`ls -la project/src`;
await $`cat project/src/index.js`;
await $`cp -r project project-backup`;
await $`rm -r project-backup`;

// Mix built-ins with pipelines and virtual commands
await $`seq 1 5 | cat > numbers.txt`;
await $`basename /path/to/file.txt .txt`; // → "file"
```

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

### Custom Options with $({ options }) Syntax (NEW!)

```javascript
import { $ } from 'command-stream';

// Create a $ with custom options
const $silent = $({ mirror: false, capture: true });
const result = await $silent`echo "quiet operation"`;

// Options for stdin handling
const $withInput = $({ stdin: 'input data\n' });
await $withInput`cat`; // Pipes the input to cat

// Custom environment variables
const $withEnv = $({ env: { ...process.env, MY_VAR: 'value' } });
await $withEnv`printenv MY_VAR`; // Prints: value

// Custom working directory
const $inTmp = $({ cwd: '/tmp' });
await $inTmp`pwd`; // Prints: /tmp

// Combine multiple options
const $custom = $({
  stdin: 'test data',
  mirror: false,
  capture: true,
  cwd: '/tmp'
});
await $custom`cat > output.txt`; // Writes to /tmp/output.txt silently

// Reusable configurations
const $prod = $({ env: { NODE_ENV: 'production' }, capture: true });
await $prod`npm start`;
await $prod`npm test`;
```

### Execution Control (NEW!)

```javascript
import { $ } from 'command-stream';

// Commands don't auto-start when created
const cmd = $`echo "hello"`;

// Three ways to start execution:

// 1. Explicit start with options
cmd.start();                    // Default async mode
cmd.start({ mode: 'async' });   // Explicitly async
cmd.start({ mode: 'sync' });    // Synchronous execution

// 2. Convenience methods
cmd.async();  // Same as start({ mode: 'async' })
cmd.sync();   // Same as start({ mode: 'sync' })

// 3. Auto-start by awaiting (always async)
await cmd;    // Auto-starts in async mode

// Event handlers can be attached before starting
const process = $`long-command`
  .on('data', chunk => console.log('Received:', chunk))
  .on('end', result => console.log('Done!'));

// Start whenever you're ready
process.start();
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

// Attach event handlers then start execution
$`command`
  .on('data', chunk => {
    if (chunk.type === 'stdout') {
      console.log('Stdout:', chunk.data.toString());
    }
  })
  .on('stderr', chunk => console.log('Stderr:', chunk))
  .on('end', result => console.log('Done:', result))
  .on('exit', code => console.log('Exit code:', code))
  .start(); // Explicitly start the command

// Or auto-start by awaiting
const cmd = $`another-command`
  .on('data', chunk => console.log(chunk));
await cmd; // Auto-starts in async mode
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

### Cross-Platform File Operations (Built-in Commands)

Replace system-dependent operations with built-in commands that work identically everywhere:

```javascript
import { $ } from 'command-stream';

// File system operations work on Windows, macOS, and Linux identically
await $`mkdir -p project/src project/tests`;
await $`touch project/src/index.js project/tests/test.js`;

// List files with details
const files = await $`ls -la project/src`;
console.log(files.stdout);

// Copy and move operations
await $`cp project/src/index.js project/src/backup.js`;
await $`mv project/src/backup.js project/backup.js`;

// File content operations
await $`echo "export default 'Hello World';" > project/src/index.js`;
const content = await $`cat project/src/index.js`;
console.log(content.stdout);

// Path operations
const filename = await $`basename project/src/index.js .js`; // → "index"
const directory = await $`dirname project/src/index.js`;     // → "project/src"

// Generate sequences and process them
await $`seq 1 10 | cat > numbers.txt`;
const numbers = await $`cat numbers.txt`;

// Cleanup
await $`rm -r project numbers.txt`;
```

### Virtual Commands (Extensible Shell)

Create custom commands that work seamlessly alongside built-ins:

```javascript
import { $, register, unregister, listCommands } from 'command-stream';

// Register a custom command
register('greet', async (args, stdin) => {
  const name = args[0] || 'World';
  return { stdout: `Hello, ${name}!\n`, code: 0 };
});

// Use it like any other command
await $`greet Alice`;                    // → "Hello, Alice!"
await $`echo "Bob" | greet`;             // → "Hello, Bob!"

// Streaming virtual commands with async generators
register('countdown', async function* (args) {
  const start = parseInt(args[0] || 5);
  for (let i = start; i >= 0; i--) {
    yield `${i}\n`;
    await new Promise(r => setTimeout(r, 1000));
  }
});

// Use in pipelines with built-ins
await $`countdown 3 | cat > countdown.txt`;

// Virtual commands work in all patterns
for await (const chunk of $`countdown 3`.stream()) {
  console.log('Countdown:', chunk.data.toString().trim());
}

// Management functions
console.log(listCommands());  // List all registered commands
unregister('greet');          // Remove custom commands
```

#### 🔥 **Why Virtual Commands Are Revolutionary**

**No other shell library offers this level of extensibility:**

- **🚫 Bun.$**: Fixed set of built-in commands, no extensibility API
- **🚫 execa**: Transform/pipeline system, but no custom commands  
- **🚫 zx**: JavaScript functions only, no shell command integration

**command-stream breaks the barrier** between JavaScript functions and shell commands:

```javascript
// ❌ Other libraries: Choose JavaScript OR shell
await execa('node', ['script.js']);  // execa: separate processes
await $`node script.js`;             // zx: shell commands only

// ✅ command-stream: JavaScript functions AS shell commands  
register('deploy', async (args) => {
  const env = args[0] || 'staging';
  await deployToEnvironment(env);
  return { stdout: `Deployed to ${env}!\n`, code: 0 };
});

await $`deploy production`;           // JavaScript function as shell command!
await $`deploy staging | tee log.txt`; // Works in pipelines!
```

**Unique capabilities:**
- **Seamless Integration**: Virtual commands work exactly like built-ins
- **Pipeline Support**: Full stdin/stdout passing between virtual and system commands
- **Streaming**: Async generators for real-time output
- **Dynamic Registration**: Add/remove commands at runtime
- **Option Awareness**: Virtual commands respect `cwd`, `env`, etc.

### 🔗 **Advanced Pipeline Support**

**command-stream offers the most advanced piping system in the JavaScript ecosystem:**

#### **Shell-Style Piping (Traditional)**

```javascript
import { $, register } from 'command-stream';

// ✅ Standard shell piping (like all libraries)
await $`echo "hello world" | wc -w`;  // → "2"

// ✅ Built-in to built-in piping  
await $`seq 1 5 | cat > numbers.txt`;

// ✅ System to built-in piping
await $`git log --oneline | head -n 5`;

// 🚀 UNIQUE: Virtual command piping
register('uppercase', async (args, stdin) => {
  return { stdout: stdin.toUpperCase(), code: 0 };
});

register('reverse', async (args, stdin) => {
  return { stdout: stdin.split('').reverse().join(''), code: 0 };
});

// ✅ Built-in to virtual piping
await $`echo "hello" | uppercase`;  // → "HELLO"

// ✅ Virtual to virtual piping  
await $`echo "hello" | uppercase | reverse`;  // → "OLLEH"

// ✅ Mixed pipelines (system + built-in + virtual)
await $`git log --oneline | head -n 3 | uppercase | cat > LOG.txt`;

// ✅ Complex multi-stage pipelines
await $`find . -name "*.js" | head -n 10 | basename | sort | uniq`;
```

#### **🚀 Programmatic .pipe() Method (NEW!)**

**World's first shell library with full `.pipe()` method support for virtual commands:**

```javascript
import { $, register } from 'command-stream';

// ✅ Basic programmatic piping
const result = await $`echo "hello"`.pipe($`echo "World: $(cat)"`);

// 🌟 Virtual command chaining
register('add-prefix', async (args, stdin) => {
  const prefix = args[0] || 'PREFIX:';
  return { stdout: `${prefix} ${stdin.trim()}\n`, code: 0 };
});

register('add-suffix', async (args, stdin) => {
  const suffix = args[0] || 'SUFFIX';
  return { stdout: `${stdin.trim()} ${suffix}\n`, code: 0 };
});

// ✅ Chain virtual commands with .pipe()
const result = await $`echo "Hello"`
  .pipe($`add-prefix "[PROCESSED]"`)
  .pipe($`add-suffix "!!!"`);
// → "[PROCESSED] Hello !!!"

// ✅ Mix with built-in commands
const fileData = await $`cat large-file.txt`
  .pipe($`head -n 100`)
  .pipe($`add-prefix "Line:"`);

// ✅ Error handling in pipelines
try {
  const result = await $`cat nonexistent.txt`.pipe($`add-prefix "Data:"`);
} catch (error) {
  // Source error propagates - destination never executes
  console.log('File not found, pipeline stopped');
}

// ✅ Complex data processing
register('json-parse', async (args, stdin) => {
  try {
    const data = JSON.parse(stdin);
    return { stdout: JSON.stringify(data, null, 2), code: 0 };
  } catch (error) {
    return { stdout: '', stderr: `JSON Error: ${error.message}`, code: 1 };
  }
});

register('extract-field', async (args, stdin) => {
  const field = args[0];
  try {
    const data = JSON.parse(stdin);
    const value = data[field] || 'null';
    return { stdout: `${value}\n`, code: 0 };
  } catch (error) {
    return { stdout: '', stderr: `Extract Error: ${error.message}`, code: 1 };
  }
});

// Real-world API processing pipeline
const userName = await $`curl -s https://api.github.com/users/octocat`
  .pipe($`json-parse`)
  .pipe($`extract-field name`);
// → "The Octocat"

// Cleanup
unregister('add-prefix');
unregister('add-suffix');
unregister('json-parse');
unregister('extract-field');
```

#### **🆚 How We Compare**

| Library | Pipeline Types | Custom Commands in Pipes | `.pipe()` Method | Real-time Streaming |
|---------|----------------|---------------------------|------------------|---------------------|
| **command-stream** | ✅ System + Built-ins + Virtual + Mixed | ✅ **Full support** | ✅ **Full virtual command support** | ✅ **Yes** |
| **Bun.$** | ✅ System + Built-ins | ❌ No custom commands | ❌ No `.pipe()` method | ❌ No |
| **execa** | ✅ Programmatic `.pipe()` | ❌ No shell integration | ✅ Basic process piping | 🟡 Limited |
| **zx** | ✅ Shell piping + `.pipe()` | ❌ No custom commands | ✅ Stream piping only | ❌ No |

**🎯 Unique Advantages:**
- **Virtual commands work seamlessly in both shell pipes AND `.pipe()` method** - no other library can do this
- **Mixed pipeline types** - combine system, built-in, and virtual commands freely in both syntaxes
- **Real-time streaming** through virtual command pipelines  
- **Full stdin/stdout passing** between all command types
- **Dual piping syntax** - use shell `|` OR programmatic `.pipe()` interchangeably

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

- `start(options)`: Explicitly start command execution
  - `options.mode`: `'async'` (default) or `'sync'` - execution mode
- `async()`: Shortcut for `start({ mode: 'async' })` - start async execution
- `sync()`: Shortcut for `start({ mode: 'sync' })` - execute synchronously (blocks until completion)
- `stream()`: Returns an async iterator for real-time chunk processing
- `pipe(destination)`: Programmatically pipe output to another command (returns new ProcessRunner)
- `then()`, `catch()`, `finally()`: Promise interface for await support (auto-starts in async mode)

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
- Use `$({ options })` syntax for one-off configurations with template literals
- Use `sh(command, options)` for one-off overrides with string commands
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

### Virtual Commands API

Control and extend the command system with custom JavaScript functions:

#### Functions

- `register(name, handler)`: Register a virtual command
  - `name`: Command name (string)
  - `handler`: Function or async generator `(args, stdin, options) => result`
- `unregister(name)`: Remove a virtual command
- `listCommands()`: Get array of all registered command names  
- `enableVirtualCommands()`: Enable virtual command processing
- `disableVirtualCommands()`: Disable virtual commands (use system commands only)

#### Handler Function Signature

```javascript
// Regular async function
async function handler(args, stdin, options) {
  return {
    code: 0,           // Exit code (number)
    stdout: "output",  // Standard output (string)
    stderr: "",        // Standard error (string)
  };
}

// Async generator for streaming
async function* streamingHandler(args, stdin, options) {
  yield "chunk1\n";
  yield "chunk2\n";
  // Each yield sends a chunk in real-time
}
```

### Built-in Commands

18 cross-platform commands that work identically everywhere:

**File System**: `cat`, `ls`, `mkdir`, `rm`, `mv`, `cp`, `touch`  
**Utilities**: `basename`, `dirname`, `seq`, `yes`  
**System**: `cd`, `pwd`, `echo`, `sleep`, `true`, `false`, `which`, `exit`, `env`, `test`

All built-in commands support:
- Standard flags (e.g., `ls -la`, `mkdir -p`, `rm -rf`)
- Pipeline operations
- Option awareness (`cwd`, `env`, etc.)
- Bash-compatible error messages and exit codes

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
  child: ChildProcess, // Original child process object
  async text()         // Bun.$ compatibility method - returns stdout as string
}
```

#### `.text()` Method (Bun.$ Compatibility)

For compatibility with Bun.$, all result objects include an async `.text()` method:

```javascript
import { $ } from 'command-stream';

// Both sync and async execution support .text()
const result1 = await $`echo "hello world"`;
const text1 = await result1.text(); // "hello world\n"

const result2 = $`echo "sync example"`.sync();  
const text2 = await result2.text(); // "sync example\n"

// .text() is equivalent to accessing .stdout
expect(await result.text()).toBe(result.stdout);

// Works with built-in commands
const result3 = await $`seq 1 3`;
const text3 = await result3.text(); // "1\n2\n3\n"

// Works with .pipe() method
const result4 = await $`echo "pipe test"`.pipe($`cat`);
const text4 = await result4.text(); // "pipe test\n"
```

## Signal Handling (CTRL+C Support)

The library properly handles CTRL+C (SIGINT) signals, ensuring child processes are terminated gracefully when you interrupt execution:

### How It Works

1. **Automatic Signal Forwarding**: When you press CTRL+C, the signal is automatically forwarded to all child processes
2. **Parent Process Continues**: The parent process doesn't exit - it just forwards the signal and continues running
3. **Process Groups**: Child processes are spawned in their own process groups for proper signal isolation  
4. **TTY Mode Support**: When running interactively, CTRL+C is properly detected even in raw TTY mode
5. **Graceful Cleanup**: Resources are properly cleaned up when processes are interrupted

### Examples

```javascript
// Long-running command that can be interrupted with CTRL+C
try {
  await $`ping 8.8.8.8`;  // Press CTRL+C to stop
} catch (error) {
  console.log('Command interrupted:', error.code); // Exit code 130 (SIGINT)
}

// Multiple concurrent processes - CTRL+C stops all
try {
  await Promise.all([
    $`sleep 100`,
    $`ping google.com`,
    $`tail -f /var/log/system.log`
  ]);
} catch (error) {
  // All processes are terminated when you press CTRL+C
}

// Works with streaming patterns too
try {
  for await (const chunk of $`ping 8.8.8.8`.stream()) {
    console.log(chunk);
    // Press CTRL+C to break the loop and stop the process
  }
} catch (error) {
  console.log('Streaming interrupted');
}
```

### Signal Handling Behavior

- **Default**: Inherits stdin and properly forwards CTRL+C to child processes
- **Interactive Commands**: Commands like `vim`, `less`, `top` work correctly with their own signal handling
- **Non-Interactive**: Commands like `ping`, `sleep`, `tail -f` can be interrupted with CTRL+C
- **Exit Codes**: Interrupted processes typically exit with code 130 (128 + SIGINT signal number)

## Testing

```bash
# Run comprehensive test suite (266 tests)
bun test

# Run tests with coverage report
bun test --coverage

# Run specific test categories
npm run test:features    # Feature comparison tests
npm run test:builtin     # Built-in commands tests
npm run test:pipe        # .pipe() method tests
npm run test:sync        # Synchronous execution tests
```

## Requirements

- **Bun**: >= 1.0.0 (primary runtime)
- **Node.js**: >= 20.0.0 (compatibility support)

## Roadmap

### 🔄 **Coming Soon**
- **TypeScript Support**: Full .d.ts definitions and type safety
- **Enhanced Shell Options**: `set -u` (nounset) and `set -o pipefail` support
- **More Built-in Commands**: Additional cross-platform utilities

### 💡 **Planned Features**
- **Performance Optimizations**: Further Bun runtime optimizations
- **Advanced Error Handling**: Enhanced error context and debugging
- **Plugin System**: Extensible architecture for custom integrations

## Contributing

We welcome contributions! Since command-stream is **public domain software**, your contributions will also be released into the public domain.

### 🚀 **Getting Started**
```bash
git clone https://github.com/link-foundation/command-stream.git
cd command-stream
bun install
bun test  # Run the full test suite
```

### 📋 **Development Guidelines**
- All features must have comprehensive tests
- Built-in commands should match bash/sh behavior exactly
- Maintain cross-platform compatibility (Windows, macOS, Linux)
- Follow the existing code style and patterns

### 🧪 **Running Tests**
```bash
bun test                    # All 266 tests
bun test tests/pipe.test.mjs # Specific test file
npm run test:builtin        # Built-in commands only
```

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
