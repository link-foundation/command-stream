[![npm](https://img.shields.io/npm/v/command-stream.svg)](https://npmjs.com/command-stream)
[![License](https://img.shields.io/badge/license-Unlicense-blue.svg)](https://github.com/link-foundation/command-stream/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/link-foundation/command-stream?style=social)](https://github.com/link-foundation/command-stream/stargazers)

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

| Feature | [**command-stream**](https://github.com/link-foundation/command-stream) | [**execa**](https://github.com/sindresorhus/execa) | [**cross-spawn**](https://github.com/moxystudio/node-cross-spawn) | [**Bun.$**](https://github.com/oven-sh/bun) | [**ShellJS**](https://github.com/shelljs/shelljs) | [**zx**](https://github.com/google/zx) |
|---------|----------------|-------|-------|-----|-------|-------|
| **📦 NPM Package** | [![npm](https://img.shields.io/npm/v/command-stream.svg)](https://www.npmjs.com/package/command-stream) | [![npm](https://img.shields.io/npm/v/execa.svg)](https://www.npmjs.com/package/execa) | [![npm](https://img.shields.io/npm/v/cross-spawn.svg)](https://www.npmjs.com/package/cross-spawn) | N/A (Built-in) | [![npm](https://img.shields.io/npm/v/shelljs.svg)](https://www.npmjs.com/package/shelljs) | [![npm](https://img.shields.io/npm/v/zx.svg)](https://www.npmjs.com/package/zx) |
| **⭐ GitHub Stars** | [**⭐ 2** (Please ⭐ us!)](https://github.com/link-foundation/command-stream) | [⭐ 7,264](https://github.com/sindresorhus/execa) | [⭐ 1,149](https://github.com/moxystudio/node-cross-spawn) | [⭐ 80,169](https://github.com/oven-sh/bun) (Full Runtime) | [⭐ 14,375](https://github.com/shelljs/shelljs) | [⭐ 44,569](https://github.com/google/zx) |
| **📊 Monthly Downloads** | **893** (New project!) | **381M** | **409M** | N/A (Built-in) | **35M** | **4.2M** |
| **📈 Total Downloads** | **Growing** | **6B+** | **5.4B** | N/A (Built-in) | **596M** | **37M** |
| **Runtime Support** | ✅ Bun + Node.js | ✅ Node.js | ✅ Node.js | 🟡 Bun only | ✅ Node.js | ✅ Node.js |
| **Template Literals** | ✅ `` $`cmd` `` | ✅ `` $`cmd` `` | ❌ Function calls | ✅ `` $`cmd` `` | ❌ Function calls | ✅ `` $`cmd` `` |
| **Command Builder API** | ✅ **`$.command()`** injection-safe | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Real-time Streaming** | ✅ Live output | 🟡 Limited | ❌ Buffer only | ❌ Buffer only | ❌ Buffer only | ❌ Buffer only |
| **Synchronous Execution** | ✅ `.sync()` with events | ✅ `execaSync` | ✅ `spawnSync` | ❌ No | ✅ Sync by default | ❌ No |
| **Async Iteration** | ✅ `for await (chunk of $.stream())` | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **EventEmitter Pattern** | ✅ `.on('data', ...)` | 🟡 Limited events | 🟡 Child process events | ❌ No | ❌ No | ❌ No |
| **Mixed Patterns** | ✅ Events + await/sync | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Bun.$ Compatibility** | ✅ `.text()` method support | ❌ No | ❌ No | ✅ Native API | ❌ No | ❌ No |
| **Shell Injection Protection** | ✅ Smart auto-quoting | ✅ Safe by default | ✅ Safe by default | ✅ Built-in | 🟡 Manual escaping | ✅ Safe by default |
| **Cross-platform** | ✅ macOS/Linux/Windows | ✅ Yes | ✅ **Specialized** cross-platform | ✅ Yes | ✅ Yes | ✅ Yes |
| **Performance** | ⚡ Fast (Bun optimized) | 🐌 Moderate | ⚡ Fast | ⚡ Very fast | 🐌 Moderate | 🐌 Slow |
| **Memory Efficiency** | ✅ Streaming prevents buildup | 🟡 Buffers in memory | 🟡 Buffers in memory | 🟡 Buffers in memory | 🟡 Buffers in memory | 🟡 Buffers in memory |
| **Error Handling** | ✅ Configurable (`set -e`/`set +e`, non-zero OK by default) | ✅ Throws on error | ❌ Basic (exit codes) | ✅ Throws on error | ✅ Configurable | ✅ Throws on error |
| **Shell Settings** | ✅ `set -e`/`set +e` equivalent | ❌ No | ❌ No | ❌ No | 🟡 Limited (`set()`) | ❌ No |
| **Stdout Support** | ✅ Real-time streaming + events | ✅ Node.js streams + interleaved | ✅ Inherited/buffered | ✅ Shell redirection + buffered | ✅ Direct output | ✅ Readable streams + `.pipe.stdout` |
| **Stderr Support** | ✅ Real-time streaming + events | ✅ Streams + interleaved output | ✅ Inherited/buffered | ✅ Redirection + `.quiet()` access | ✅ Error output | ✅ Readable streams + `.pipe.stderr` |
| **Stdin Support** | ✅ string/Buffer/inherit/ignore | ✅ Input/output streams | ✅ Full stdio support | ✅ Pipe operations | 🟡 Basic | ✅ Basic stdin |
| **Built-in Commands** | ✅ **18 commands**: cat, ls, mkdir, rm, mv, cp, touch, basename, dirname, seq, yes + all Bun.$ commands | ❌ Uses system | ❌ Uses system | ✅ echo, cd, etc. | ✅ **20+ commands**: cat, ls, mkdir, rm, mv, cp, etc. | ❌ Uses system |
| **Virtual Commands Engine** | ✅ **Revolutionary**: Register JavaScript functions as shell commands with full pipeline support | ❌ No custom commands | ❌ No custom commands | ❌ No extensibility | ❌ No custom commands | ❌ No custom commands |
| **Pipeline/Piping Support** | ✅ **Advanced**: System + Built-ins + Virtual + Mixed + `.pipe()` method | ✅ Programmatic `.pipe()` + multi-destination | ❌ No piping | ✅ Standard shell piping | ✅ Shell piping + `.to()` method | ✅ Shell piping + `.pipe()` method |
| **Bundle Size** | 📦 **~20KB gzipped** | 📦 ~400KB+ (packagephobia) | 📦 ~2KB gzipped | 🎯 0KB (built-in) | 📦 ~15KB gzipped | 📦 ~50KB+ (estimated) |
| **Signal Handling** | ✅ **Advanced SIGINT/SIGTERM forwarding** with cleanup | 🟡 Basic | ✅ **Excellent** cross-platform | 🟡 Basic | 🟡 Basic | 🟡 Basic |
| **Process Management** | ✅ **Robust child process lifecycle** with proper termination | ✅ Good | ✅ **Excellent** spawn wrapper | ❌ Basic | 🟡 Limited | 🟡 Limited |
| **Debug Tracing** | ✅ **Comprehensive VERBOSE logging** for CI/debugging | 🟡 Limited | ❌ No | ❌ No | 🟡 Basic | ❌ No |
| **Test Coverage** | ✅ **518+ tests, 1165+ assertions** | ✅ Excellent | ✅ Good | 🟡 Good coverage | ✅ Good | 🟡 Good |
| **CI Reliability** | ✅ **Platform-specific handling** (macOS/Ubuntu) | ✅ Good | ✅ **Excellent** | 🟡 Basic | ✅ Good | 🟡 Basic |
| **Documentation** | ✅ **Comprehensive examples + guides** | ✅ Excellent | 🟡 Basic | ✅ Good | ✅ Good | 🟡 Limited |
| **TypeScript** | 🔄 Coming soon | ✅ Full support | ✅ Built-in | ✅ Built-in | 🟡 Community types | ✅ Full support |
| **License** | ✅ **Unlicense (Public Domain)** | 🟡 MIT | 🟡 MIT | 🟡 MIT (+ LGPL dependencies) | 🟡 BSD-3-Clause | 🟡 Apache 2.0 |

**📊 Popularity & Adoption:** 
- **⭐ GitHub Stars:** [Bun: 80,169](https://github.com/oven-sh/bun) • [zx: 44,569](https://github.com/google/zx) • [ShellJS: 14,375](https://github.com/shelljs/shelljs) • [execa: 7,264](https://github.com/sindresorhus/execa) • [cross-spawn: 1,149](https://github.com/moxystudio/node-cross-spawn) • [**command-stream: 2 ⭐ us!**](https://github.com/link-foundation/command-stream)
- **📈 Total Downloads:** [execa: 6B+](https://www.npmjs.com/package/execa) • [cross-spawn: 5.4B](https://www.npmjs.com/package/cross-spawn) • [ShellJS: 596M](https://www.npmjs.com/package/shelljs) • [zx: 37M](https://www.npmjs.com/package/zx) • [command-stream: Growing](https://www.npmjs.com/package/command-stream)
- **📊 Monthly Downloads:** [cross-spawn: 409M](https://www.npmjs.com/package/cross-spawn) • [execa: 381M](https://www.npmjs.com/package/execa) • [ShellJS: 35M](https://www.npmjs.com/package/shelljs) • [zx: 4.2M](https://www.npmjs.com/package/zx) • [command-stream: 893 (growing!)](https://www.npmjs.com/package/command-stream)

**⭐ Help Us Grow!** If command-stream's **revolutionary virtual commands** and **advanced streaming capabilities** help your project, [**please star us on GitHub**](https://github.com/link-foundation/command-stream) to help the project grow!

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
- **🛡️ Production Ready**: **518+ tests, 1165+ assertions** with comprehensive coverage including CI reliability
- **🎯 Advanced Signal Handling**: Robust SIGINT/SIGTERM forwarding with proper child process cleanup
- **🔍 Debug-Friendly**: Comprehensive VERBOSE tracing for CI debugging and troubleshooting

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

## Smart Quoting & Security

Command-stream provides intelligent auto-quoting to protect against shell injection while avoiding unnecessary quotes for safe strings:

### Smart Quoting Behavior

```javascript
import { $ } from 'command-stream';

// Safe strings are NOT quoted (performance optimization)
await $`echo ${name}`;           // name = "hello" → echo hello
await $`${cmd} --version`;       // cmd = "/usr/bin/node" → /usr/bin/node --version

// Dangerous strings are automatically quoted for safety
await $`echo ${userInput}`;      // userInput = "test; rm -rf /" → echo 'test; rm -rf /'
await $`echo ${pathWithSpaces}`; // pathWithSpaces = "/my path/file" → echo '/my path/file'

// Special characters that trigger auto-quoting:
// Spaces, $, ;, |, &, >, <, `, *, ?, [, ], {, }, (, ), !, #, and others

// User-provided quotes are preserved
const quotedPath = "'/path with spaces/file'";
await $`cat ${quotedPath}`;      // → cat '/path with spaces/file' (no double-quoting!)

const doubleQuoted = '"/path with spaces/file"';
await $`cat ${doubleQuoted}`;    // → cat '"/path with spaces/file"' (preserves intent)
```

### Shell Injection Protection

All interpolated values are automatically secured:

```javascript
// ✅ SAFE - All these injection attempts are neutralized
const dangerous = "'; rm -rf /; echo '";
await $`echo ${dangerous}`;      // → echo ''\'' rm -rf /; echo '\'''

const cmdSubstitution = "$(whoami)";
await $`echo ${cmdSubstitution}`; // → echo '$(whoami)' (literal text, not executed)

const varExpansion = "$HOME";
await $`echo ${varExpansion}`;   // → echo '$HOME' (literal text, not expanded)

// ✅ SAFE - Even complex injection attempts
const complex = "`cat /etc/passwd`";
await $`echo ${complex}`;        // → echo '`cat /etc/passwd`' (literal text)
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

// Interactive mode for TTY commands (requires TTY environment)
const $interactive = $({ interactive: true });
await $interactive`vim myfile.txt`; // Full TTY access for editor
await $interactive`less README.md`; // Proper pager interaction

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

### Command Builder API (🚀 NEW!)

**Safe, injection-free command construction with fluent API:**

```javascript
import { $ } from 'command-stream';

// Basic usage - exactly as requested in the issue
const result = await $.command("cat", "./some-file.txt").pipe(
  $.command.stdout("inherit"),
  $.command.exitCode
).run();

// Method chaining for configuration
const result2 = await $.command('echo', 'hello world')
  .arg('extra', 'arguments')
  .stdout('inherit')
  .capture(true)
  .env({ DEBUG: '1' })
  .cwd('/tmp')
  .run();

// Safe argument handling - prevents shell injection
const userInput = "dangerous; rm -rf /";
const safeResult = await $.command('echo', userInput).run();
console.log(safeResult.stdout); // Outputs literal string, not executed

// Environment and working directory
const envResult = await $.command('env')
  .env({ MY_VAR: 'value', ANOTHER: 'test' })
  .run({ capture: true, mirror: false });

// stdin input
const stdinResult = await $.command('cat')
  .stdin('Hello from stdin!')
  .run({ capture: true, mirror: false });

// Complex argument escaping handled automatically
const complexArgs = await $.command('echo', 'file with spaces.txt', "quotes'and\"stuff")
  .run({ capture: true, mirror: false });

// Direct access to CommandBuilder and command function
import { CommandBuilder, command } from 'command-stream';

const cmd = new CommandBuilder('ls', ['-la']);
const cmd2 = command('pwd'); // Factory function
```

**Key Features:**
- **🛡️ Injection-Safe**: All arguments are properly escaped automatically
- **🔗 Fluent API**: Method chaining for readable configuration
- **⚙️ Full Configuration**: stdin, stdout, stderr, env, cwd, capture, mirror
- **🔧 Pipe Support**: Works with pipe configuration functions
- **✅ Type Safety**: No shell parsing - direct argument passing
- **🏗️ Extensible**: Use CommandBuilder class directly for advanced cases

**Why Use Command Builder?**
- **Security**: Eliminates shell injection vulnerabilities
- **Clarity**: Explicit arguments vs. string interpolation
- **Compatibility**: Similar to Rust's `std::process::Command` and Effect's `Command`
- **Reliability**: Arguments are passed exactly as intended

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

### Streaming Interfaces

Advanced streaming interfaces for fine-grained process control:

```javascript
import { $ } from 'command-stream';

// 🎯 STDIN CONTROL: Send data to interactive commands (real-time)
const grepCmd = $`grep "important"`;
const stdin = await grepCmd.streams.stdin; // Available immediately

stdin.write('ignore this line\n');
stdin.write('important message\n');
stdin.write('skip this too\n');
stdin.end();

const result = await grepCmd;
console.log(result.stdout); // "important message\n"

// 🔧 BINARY DATA: Access raw buffers (after command finishes)
const cmd = $`echo "Hello World"`;
const buffer = await cmd.buffers.stdout; // Complete snapshot
console.log(buffer.length); // 12

// 📝 TEXT DATA: Access as strings (after command finishes)
const textCmd = $`echo "Hello World"`;
const text = await textCmd.strings.stdout; // Complete snapshot
console.log(text.trim()); // "Hello World"

// ⚡ PROCESS CONTROL: Kill commands that ignore stdin
const pingCmd = $`ping google.com`;

// Some commands ignore stdin input
const pingStdin = await pingCmd.streams.stdin;
if (pingStdin) {
  pingStdin.write('q\n'); // ping ignores this
}

// Use kill() for forceful termination
setTimeout(() => pingCmd.kill(), 2000);
const pingResult = await pingCmd;
console.log('Ping stopped with code:', pingResult.code); // 143 (SIGTERM)

// 🔄 MIXED STDOUT/STDERR: Handle both streams (complete snapshots)
const mixedCmd = $`sh -c 'echo "out" && echo "err" >&2'`;
const [stdout, stderr] = await Promise.all([
  mixedCmd.strings.stdout, // Available after finish
  mixedCmd.strings.stderr  // Available after finish
]);
console.log('Out:', stdout.trim()); // "out"  
console.log('Err:', stderr.trim()); // "err"

// 🏃‍♂️ AUTO-START: Streams auto-start processes when accessed
const cmd = $`echo "test"`;
console.log('Started?', cmd.started); // false

const output = await cmd.streams.stdout; // Auto-starts, immediate access
console.log('Started?', cmd.started); // true

// 🔙 BACKWARD COMPATIBLE: Traditional await still works
const traditional = await $`echo "still works"`;
console.log(traditional.stdout); // "still works\n"
```

**Key Features:**
- `command.streams.stdin/stdout/stderr` - Direct access to Node.js streams  
- `command.buffers.stdin/stdout/stderr` - Binary data as Buffer objects
- `command.strings.stdin/stdout/stderr` - Text data as strings
- `command.kill()` - Forceful process termination
- **Auto-start behavior:** Process starts only when accessing stream properties
- **Perfect for:** Interactive commands (grep, sort, bc), data processing, real-time control
- **Network commands (ping, wget) ignore stdin** → Use `kill()` method instead

**🚀 Streams vs Buffers/Strings:**
- **`streams.*`** - Available **immediately** when command starts, for real-time interaction
- **`buffers.*` & `strings.*`** - Complete **snapshots** available only **after** command finishes

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
register('greet', async ({ args, stdin }) => {
  const name = args[0] || 'World';
  return { stdout: `Hello, ${name}!\n`, code: 0 };
});

// Use it like any other command
await $`greet Alice`;                    // → "Hello, Alice!"
await $`echo "Bob" | greet`;             // → "Hello, Bob!"

// Streaming virtual commands with async generators
register('countdown', async function* ({ args }) {
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
register('deploy', async ({ args }) => {
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
register('uppercase', async ({ args, stdin }) => {
  return { stdout: stdin.toUpperCase(), code: 0 };
});

register('reverse', async ({ args, stdin }) => {
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
register('add-prefix', async ({ args, stdin }) => {
  const prefix = args[0] || 'PREFIX:';
  return { stdout: `${prefix} ${stdin.trim()}\n`, code: 0 };
});

register('add-suffix', async ({ args, stdin }) => {
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
register('json-parse', async ({ args, stdin }) => {
  try {
    const data = JSON.parse(stdin);
    return { stdout: JSON.stringify(data, null, 2), code: 0 };
  } catch (error) {
    return { stdout: '', stderr: `JSON Error: ${error.message}`, code: 1 };
  }
});

register('extract-field', async ({ args, stdin }) => {
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
  mirror: true,        // Live output to terminal (stdout→stdout, stderr→stderr)
  capture: true,       // Capture output for programmatic access
  stdin: 'inherit',    // Inherit stdin from parent process
  interactive: false   // Explicitly request TTY forwarding for interactive commands
}
```

**Option Details:**
- `mirror: boolean` - Whether to pipe output to terminal in real-time
- `capture: boolean` - Whether to capture output in result object
- `stdin: 'inherit' | 'ignore' | string | Buffer` - How to handle stdin
- `interactive: boolean` - Enable TTY forwarding for interactive commands (requires `stdin: 'inherit'` and TTY environment)
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

#### Error Handling Modes

```javascript
import { $, shell } from 'command-stream';

// ✅ Default behavior: Commands don't throw on non-zero exit
const result = await $`ls nonexistent-file`; // Won't throw
console.log(result.code); // → 2 (non-zero, but no exception)

// ✅ Enable errexit: Commands throw on non-zero exit
shell.errexit(true);
try {
  await $`ls nonexistent-file`; // Throws error
} catch (error) {
  console.log('Command failed:', error.code); // → 2
}

// ✅ Disable errexit: Back to non-throwing behavior
shell.errexit(false);
await $`ls nonexistent-file`; // Won't throw, returns result with code 2

// ✅ One-time override without changing global settings
try {
  const result = await $`ls nonexistent-file`;
  if (result.code !== 0) {
    throw new Error(`Command failed with code ${result.code}`);
  }
} catch (error) {
  console.log('Manual error handling');
}
```

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

#### Advanced Virtual Command Features

```javascript
import { $, register } from 'command-stream';

// ✅ Cancellation support with AbortController
register('cancellable', async function* ({ args, stdin, abortSignal }) {
  for (let i = 0; i < 10; i++) {
    if (abortSignal?.aborted) {
      break; // Proper cancellation handling
    }
    yield `Count: ${i}\n`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
});

// ✅ Access to all process options
// All original options (built-in + custom) are available in the 'options' object
// Common options like cwd, env are also available at top level for convenience
// Runtime additions: isCancelled function, abortSignal
register('debug-info', async ({ args, stdin, cwd, env, options, isCancelled }) => {
  return {
    stdout: JSON.stringify({
      args,
      cwd,  // Available at top level for convenience
      env: Object.keys(env || {}),  // Available at top level for convenience
      stdinLength: stdin?.length || 0,
      allOptions: options,  // All original options (built-in + custom)
      mirror: options.mirror,  // Built-in option from options object
      capture: options.capture,  // Built-in option from options object
      customOption: options.customOption || 'not provided',  // Custom option
      isCancelledAvailable: typeof isCancelled === 'function'
    }, null, 2),
    code: 0
  };
});

// ✅ Error handling and non-zero exit codes
register('maybe-fail', async ({ args }) => {
  if (Math.random() > 0.5) {
    return {
      stdout: 'Success!\n',
      code: 0
    };
  } else {
    return {
      stdout: '',
      stderr: 'Random failure occurred\n',
      code: 1
    };
  }
});

// ✅ Example: User options flow through to virtual commands
register('show-options', async ({ args, stdin, options, cwd }) => {
  return {
    stdout: `Custom: ${options.customValue || 'none'}, CWD: ${cwd || options.cwd || 'default'}\n`,
    code: 0
  };
});

// Usage example showing options passed to virtual command:
const result = await $({ customValue: 'hello world', cwd: '/tmp' })`show-options`;
console.log(result.stdout); // Output: Custom: hello world, CWD: /tmp
```

#### Handler Function Signature

```javascript
// Regular async function
async function handler({ args, stdin, abortSignal, cwd, env, options, isCancelled }) {
  // All original options available in 'options': options.mirror, options.capture, options.customValue, etc.
  // Common options like cwd, env also available at top level for convenience
  return {
    code: 0,           // Exit code (number)
    stdout: "output",  // Standard output (string)
    stderr: "",        // Standard error (string)
  };
}

// Async generator for streaming
async function streamingHandler({ args, stdin, abortSignal, cwd, env, options, isCancelled }) {
  // Access both built-in and custom options from 'options' object
  if (options.customFlag) {
    yield "custom behavior\n";
  }
  yield "chunk1\n";
  yield "chunk2\n";
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

The library provides **advanced CTRL+C handling** that properly manages signals across different scenarios:

### How It Works

1. **Smart Signal Forwarding**: CTRL+C is forwarded **only when child processes are active**
2. **User Handler Preservation**: When no children are running, your custom SIGINT handlers work normally
3. **Process Groups**: Child processes use detached spawning for proper signal isolation
4. **TTY Mode Support**: Raw TTY mode is properly managed and restored on interruption
5. **Graceful Termination**: Uses SIGTERM → SIGKILL escalation for robust process cleanup
6. **Exit Code Standards**: Proper signal exit codes (130 for SIGINT, 143 for SIGTERM)

### Advanced Signal Behavior

```javascript
// ✅ Smart signal handling - only interferes when necessary
import { $ } from 'command-stream';

// Case 1: No children active - your handlers work normally  
process.on('SIGINT', () => {
  console.log('My custom handler runs!');
  process.exit(42); // Custom exit code
});
// Press CTRL+C → Your handler runs, exits with code 42

// Case 2: Children active - automatic forwarding
await $`ping 8.8.8.8`; // Press CTRL+C → Forwards to ping, exits with code 130

// Case 3: Multiple processes - all interrupted
await Promise.all([
  $`sleep 100`,
  $`ping google.com`  
]); // Press CTRL+C → All processes terminated, exits with code 130
```

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

- **🎯 Smart Detection**: Only forwards CTRL+C when child processes are active
- **🛡️ Non-Interference**: Preserves user SIGINT handlers when no children running  
- **⚡ Interactive Commands**: Use `interactive: true` option for commands like `vim`, `less`, `top` to enable proper TTY forwarding and signal handling
- **🔄 Process Groups**: Detached spawning ensures proper signal isolation
- **🧹 TTY Cleanup**: Raw terminal mode properly restored on interruption
- **📊 Standard Exit Codes**: 
  - `130` - SIGINT interruption (CTRL+C)
  - `143` - SIGTERM termination (programmatic kill)
  - `137` - SIGKILL force termination

### Command Resolution Priority

```javascript
// Understanding how commands are resolved:

// 1. Virtual Commands (highest priority)
register('echo', () => ({ stdout: 'virtual!\n', code: 0 }));
await $`echo test`; // → "virtual!"

// 2. Built-in Commands (if no virtual match)  
unregister('echo');
await $`echo test`; // → Uses built-in echo

// 3. System Commands (if no built-in/virtual match)
await $`unknown-command`; // → Uses system PATH lookup

// 4. Virtual Bypass (special case)
await $({ stdin: 'data' })`sleep 1`; // Bypasses virtual sleep, uses system sleep
```

## Execution Patterns Deep Dive

### When to Use Different Patterns

```javascript
import { $ } from 'command-stream';

// ✅ Use await for simple command execution
const result = await $`ls -la`;

// ✅ Use .sync() when you need blocking execution with events
const syncCmd = $`build-script`
  .on('stdout', chunk => updateProgress(chunk))
  .sync(); // Events fire after completion

// ✅ Use .start() for non-blocking execution with real-time events  
const asyncCmd = $`long-running-server`
  .on('stdout', chunk => logOutput(chunk))
  .start(); // Events fire in real-time

// ✅ Use .stream() for processing large outputs efficiently
for await (const chunk of $`generate-big-file`.stream()) {
  processChunkInRealTime(chunk);
} // Memory efficient - processes chunks as they arrive

// ✅ Use EventEmitter pattern for complex workflows
$`deployment-script`
  .on('stdout', chunk => {
    if (chunk.toString().includes('ERROR')) {
      handleError(chunk);
    }
  })
  .on('stderr', chunk => logError(chunk))
  .on('end', result => {
    if (result.code === 0) {
      notifySuccess();
    }
  })
  .start();
```

### Performance Considerations

```javascript
// 🚀 Memory Efficient: For large outputs, use streaming
for await (const chunk of $`cat huge-file.log`.stream()) {
  processChunk(chunk); // Processes incrementally
}

// 🐌 Memory Inefficient: Buffers entire output in memory
const result = await $`cat huge-file.log`;
processFile(result.stdout); // Loads everything into memory

// ⚡ Fastest: Sync execution for small, quick commands
const quickResult = $`pwd`.sync();

// 🔄 Best for UX: Async with events for long-running commands
$`npm install`
  .on('stdout', showProgress)
  .start();
```

## Testing

```bash
# Run comprehensive test suite (518+ tests)
bun test

# Run tests with coverage report
bun test --coverage

# Run specific test categories
npm run test:features    # Feature comparison tests
npm run test:builtin     # Built-in commands tests  
npm run test:pipe        # .pipe() method tests
npm run test:sync        # Synchronous execution tests
npm run test:signal      # CTRL+C signal handling tests
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
bun test                    # All 518+ tests
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
