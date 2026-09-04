# Best Practices for command-stream

This document covers best practices, common patterns, and pitfalls to avoid when using the command-stream library.

## Table of Contents

- [Array Argument Handling](#array-argument-handling)
- [String Interpolation](#string-interpolation)
- [Security Best Practices](#security-best-practices)
- [Error Handling](#error-handling)
- [Real-time Streaming](#real-time-streaming)
- [Performance Tips](#performance-tips)
- [Common Pitfalls](#common-pitfalls)
  - [7. try/catch for Exit Code Detection (Silent Bug)](#7-trycatch-for-exit-code-detection-silent-bug)

---

## Array Argument Handling

### Pass Arrays Directly

When you have multiple arguments in an array, pass the array directly to template interpolation. The library will automatically handle proper quoting for each element.

```javascript
import { $ } from 'command-stream';

// CORRECT: Pass array directly
const args = ['file.txt', '--public', '--verbose'];
await $`command ${args}`;
// Executed: command file.txt --public --verbose

// CORRECT: Dynamic array building
const baseArgs = ['input.txt'];
if (isVerbose) baseArgs.push('--verbose');
if (isForce) baseArgs.push('--force');
await $`mycommand ${baseArgs}`;
```

### Never Use .join() Before Interpolation

Calling `.join(' ')` on an array before passing to template interpolation is a common mistake that causes all elements to become a single argument.

```javascript
// WRONG: Array becomes single argument
const args = ['file.txt', '--flag'];
await $`command ${args.join(' ')}`;
// Shell receives: ['command', 'file.txt --flag'] (1 argument!)

// CORRECT: Each element becomes separate argument
await $`command ${args}`;
// Shell receives: ['command', 'file.txt', '--flag'] (2 arguments)
```

### Mixed Static and Dynamic Arguments

When combining static and dynamic arguments, use separate interpolations or arrays:

```javascript
// CORRECT: Multiple interpolations
const file = 'data.txt';
const flags = ['--verbose', '--force'];
await $`process ${file} ${flags}`;

// CORRECT: Build complete array
const allArgs = [file, ...flags];
await $`process ${allArgs}`;

// WRONG: String concatenation
await $`process ${file + ' ' + flags.join(' ')}`;
```

---

## String Interpolation

### Safe Interpolation (Default)

By default, all interpolated values are automatically quoted to prevent shell injection:

```javascript
// User input is safely escaped
const userInput = "'; rm -rf /; echo '";
await $`echo ${userInput}`;
// Executed safely - input is quoted, not executed
```

### Interpolating Inside Your Own Quotes

A value placed inside quotes you wrote yourself is spliced in as escaped literal
text instead of being wrapped in a second pair of quotes, exactly like `"$var"`
in a POSIX shell:

```javascript
const script = 'for f in *.js; do echo "Processing: $f"; done';
await $`bash -c "${script}"`; // runs the script, like: bash -c "$script"

const name = "it's here";
await $`echo '${name}'`; // → echo 'it'\''s here'
```

This is still injection-safe - the value cannot close the quote or start a new
command - and it is what makes the common `bash -c "${cmd}"` form work.

Prefer letting command-stream quote for you (no quotes in the template) unless
the value has to reach another program as a single script argument:

```javascript
// Preferred: no quotes needed
await $`cat ${path}`;

// Use your own quotes when the value is a script for another shell
await $`bash -c "${script}"`;
```

To restore the old always-quote behavior, call `shell.quoteContext(false)` or set
`COMMAND_STREAM_QUOTE_CONTEXT=0`.

### Using raw() for Trusted Commands

Only use `raw()` with trusted, hardcoded command strings:

```javascript
import { $, raw } from 'command-stream';

// CORRECT: Trusted command template
const trustedCmd = 'git log --oneline --graph';
await $`${raw(trustedCmd)}`;

// WRONG: User input with raw (security vulnerability!)
const userInput = req.body.command;
await $`${raw(userInput)}`; // DANGER: Shell injection!
```

### Paths with Spaces

Paths containing spaces are automatically quoted:

```javascript
const path = '/Users/name/My Documents/file.txt';
await $`cat ${path}`;
// Executed: cat '/Users/name/My Documents/file.txt'
```

---

## Security Best Practices

### Never Trust User Input

Always treat external input as potentially malicious:

```javascript
// CORRECT: Auto-escaping protects against injection
const filename = req.query.file;
await $`cat ${filename}`;

// WRONG: Bypassing safety for user input
await $`${raw(userInput)}`;
```

### Validate Before Execution

Add validation for critical operations:

```javascript
import { $ } from 'command-stream';

async function deleteFile(filename) {
  // Validate filename
  if (filename.includes('..') || filename.startsWith('/')) {
    throw new Error('Invalid filename');
  }

  await $`rm ${filename}`;
}
```

### Use Principle of Least Privilege

Run commands with minimal required permissions:

```javascript
// Use specific paths instead of wildcards when possible
await $`rm ${specificFile}`; // Better
await $`rm ${directory}/*`; // More risky
```

---

## Error Handling

### Check Exit Codes

By default, commands don't throw on non-zero exit codes:

```javascript
const result = await $`ls nonexistent`;
if (result.code !== 0) {
  console.error('Command failed:', result.stderr);
}
```

### Enable errexit for Critical Operations

Use shell settings for scripts that should fail on errors:

```javascript
import { $, shell } from 'command-stream';

shell.errexit(true);

try {
  await $`critical-operation`;
} catch (error) {
  console.error('Critical operation failed:', error);
  process.exit(1);
}
```

### Handle Specific Errors

```javascript
const result = await $`command`;

switch (result.code) {
  case 0:
    console.log('Success:', result.stdout);
    break;
  case 1:
    console.error('General error');
    break;
  case 127:
    console.error('Command not found');
    break;
  default:
    console.error(`Unknown error (code ${result.code})`);
}
```

---

## Real-time Streaming

### Stream Compound Commands Progressively

Use `stream()` when code must react to output before the full command finishes.
Sequences containing `;`, `&&`, `||`, subshells, or pipelines preserve
command-stream built-ins and registered virtual commands. Output from nested
system processes is forwarded as soon as it arrives:

```javascript
import { $ } from 'command-stream';

const build = $({
  mirror: false,
})`echo "build started"; npm run build; echo "build finished"`;

for await (const chunk of build.stream()) {
  if (chunk.type === 'stdout') {
    consumeBuildOutput(chunk.data);
  } else if (chunk.type === 'stderr') {
    consumeBuildError(chunk.data);
  } else if (chunk.type === 'exit') {
    console.log('build exited with', chunk.code);
  }
}
```

Always check `chunk.type`: the final `{ type: 'exit', code }` chunk has no
`data` property.

Breaking out of the loop stops the currently active command, including a real
process nested inside a compound command. Keep a runner reference when you also
need explicit cancellation:

```javascript
const watcher = $`echo "watching"; npm run watch`;

for await (const chunk of watcher.stream()) {
  if (chunk.type === 'stdout' && isReady(chunk.data)) {
    watcher.kill('SIGINT');
  }
}
```

### Choose the Right Execution Model

JavaScript process libraries generally use one of three models:

1. **Parse and interpret shell syntax in the library.** [Bun Shell](https://bun.sh/docs/runtime/shell)
   uses a lexer, parser, and interpreter with cross-platform built-ins. This is
   the model command-stream uses for supported operators so built-in and custom
   virtual commands remain available.
2. **Run an explicit system shell.** [zx](https://google.github.io/zx/shell)
   is shell-oriented, while [Node's `child_process`](https://nodejs.org/api/child_process.html)
   exposes a `shell` option. This is appropriate for trusted scripts that need
   platform shell features such as command substitution, glob expansion, file
   descriptor redirection, or background jobs. command-stream automatically
   falls back to the system shell when a compound command uses unsupported
   syntax.
3. **Spawn executables directly and compose streams programmatically.**
   [Execa](https://github.com/sindresorhus/execa) emphasizes direct process
   execution, iterable output, and programmatic pipelines; Node also exposes
   piped child streams directly. In command-stream, prefer `.pipe()` when the
   pipeline structure is built dynamically or should not depend on shell
   syntax.

Use the internal command-stream path for portable built-ins, registered virtual
commands, and ordinary sequences. Use a real shell only when its extra syntax
is required, because behavior then depends on the installed shell and custom
virtual commands do not exist inside that external process. Use `.pipe()` for
explicit application-controlled composition.

### Streaming Pitfalls

```javascript
// WRONG: waits for completion before application code can consume stdout.
const result = await $({ mirror: false })`long-running-build`;
consumeBuildOutput(result.stdout);

// CORRECT: consumes each chunk while the build is still running.
for await (const chunk of $({ mirror: false })`long-running-build`.stream()) {
  if (chunk.type === 'stdout') consumeBuildOutput(chunk.data);
}
```

Do not wrap a sequence in `sh -c` merely to make it stream. That creates a
separate shell where registered virtual commands are unavailable:

```javascript
import { $, register } from 'command-stream';

register('project-status', statusHandler);

// WRONG: the external shell cannot resolve the JavaScript virtual command.
await $`sh -c 'echo checking; project-status'`;

// CORRECT: command-stream keeps both commands in its own orchestration.
await $`echo checking; project-status`;
```

Never insert untrusted text as raw shell syntax:

```javascript
import { $, raw } from 'command-stream';

// WRONG: raw user input can introduce operators or command substitution.
await $`${raw(request.body.command)}`;

// CORRECT: interpolation treats external data as an argument.
await $`project-status ${request.body.project}`;
```

Finally, command-stream can forward only what a producer writes. Some programs
buffer output when stdout is a pipe; use that program's line-buffered,
unbuffered, or watch option when available. Increasing a test timeout does not
fix producer-side buffering.

See
[`examples/streaming-compound-commands.mjs`](./examples/streaming-compound-commands.mjs)
for a runnable compound-stream example.

---

## Performance Tips

### Use Streaming for Large Outputs

For commands that produce large outputs, use streaming to avoid memory issues:

```javascript
// Memory efficient: Process chunks as they arrive
for await (const chunk of $`cat huge-file.log`.stream()) {
  processChunk(chunk.data);
}

// Memory intensive: Buffers entire output
const result = await $`cat huge-file.log`;
processAll(result.stdout);
```

### Parallel Execution

Run independent commands in parallel:

```javascript
// Sequential (slower)
await $`task1`;
await $`task2`;
await $`task3`;

// Parallel (faster)
await Promise.all([$`task1`, $`task2`, $`task3`]);
```

### Use Built-in Commands

Built-in commands are faster as they don't spawn system processes:

```javascript
// Fast: Built-in command (pure JavaScript)
await $`mkdir -p build/output`;

// Slower: System command
await $`/bin/mkdir -p build/output`;
```

---

## Common Pitfalls

### 1. Array.join() Pitfall (Most Common)

**Problem:** Using `.join(' ')` before interpolation merges all arguments into one.

```javascript
// WRONG
const args = ['file.txt', '--flag'];
await $`cmd ${args.join(' ')}`; // 1 argument: "file.txt --flag"

// CORRECT
await $`cmd ${args}`; // 2 arguments: "file.txt", "--flag"
```

See [Case Study: Issue #153](./docs/case-studies/issue-153/README.md) for detailed analysis.

### 2. Template String Concatenation

**Problem:** Building commands with template strings creates single arguments.

```javascript
// WRONG
const file = 'data.txt';
const flag = '--verbose';
await $`cmd ${`${file} ${flag}`}`; // 1 argument: "data.txt --verbose"

// CORRECT
await $`cmd ${file} ${flag}`; // 2 arguments
```

### 3. Forgetting await

**Problem:** Commands return promises, forgetting await causes issues.

```javascript
// WRONG: Command may not complete before next line
$`setup-task`;
$`main-task`; // May run before setup completes

// CORRECT: Wait for completion
await $`setup-task`;
await $`main-task`;
```

### 4. Assuming Synchronous Behavior

**Problem:** Expecting immediate results without awaiting.

```javascript
// WRONG
const cmd = $`echo hello`;
console.log(cmd.stdout); // undefined - not yet executed!

// CORRECT
const result = await $`echo hello`;
console.log(result.stdout); // "hello\n"
```

### 5. Not Handling stderr

**Problem:** Only checking stdout when errors go to stderr.

```javascript
// INCOMPLETE
const result = await $`command`;
console.log(result.stdout);

// BETTER
const result = await $`command`;
if (result.code !== 0) {
  console.error('Error:', result.stderr);
} else {
  console.log('Success:', result.stdout);
}
```

### 6. Ignoring Exit Codes

**Problem:** Assuming success without checking.

```javascript
// WRONG
const result = await $`risky-command`;
processOutput(result.stdout); // May be empty on failure!

// CORRECT
const result = await $`risky-command`;
if (result.code === 0) {
  processOutput(result.stdout);
} else {
  handleError(result);
}
```

### 7. try/catch for Exit Code Detection (Silent Bug)

**Problem:** Using `try/catch` to detect non-zero exit codes when `errexit` is `false` (the default). Since `command-stream` defaults to `errexit: false`, commands **never throw** on non-zero exit codes unless you explicitly enable it. The `catch` block is silently never reached.

This is the root cause of the bug in [link-assistant/calculator#78](https://github.com/link-assistant/calculator/issues/78), where a CI auto-release pipeline silently skipped commits for every run.

```javascript
// WRONG: catch is NEVER reached with errexit=false (the default)
try {
  await $`git diff --cached --quiet`; // exits with code 1 when changes exist
  console.log('No changes to commit'); // ← ALWAYS runs (silent bug!)
  return;
} catch {
  // NEVER reached — no exception is thrown with errexit=false
  await $`git commit -m "Release"`;
}

// CORRECT: Always use explicit exit code check
const result = await $`git diff --cached --quiet`;
if (result.code === 0) {
  console.log('No changes to commit');
  return;
}
// code === 1: staged changes exist
await $`git commit -m "Release"`;
```

If you prefer the `try/catch` pattern, enable `errexit` first:

```javascript
import { $, shell } from 'command-stream';

shell.errexit(true); // Now commands throw on non-zero exit code

try {
  await $`git diff --cached --quiet`; // Now throws when exit code is 1
  console.log('No changes to commit');
} catch (err) {
  // Now correctly reached when exit code !== 0
  await $`git commit -m "Release"`;
}
```

See [Case Study: Issue #156](./docs/case-studies/issue-156/README.md) for detailed analysis.

---

## Quick Reference

### Do's

- Pass arrays directly: `${args}`
- Use separate interpolations: `${file} ${flag}`
- Check exit codes after execution
- Use streaming for large outputs
- Validate user input before execution
- Use built-in commands when available

### Don'ts

- Never use `args.join(' ')` before interpolation
- Never use `raw()` with user input
- Don't forget `await` on commands
- Don't assume success without checking
- Don't ignore stderr output
- Don't use `try/catch` to detect non-zero exit codes with default settings (use `result.code` instead)

---

## See Also

- [README.md](../README.md) - Main documentation
- [docs/case-studies/issue-153/README.md](./docs/case-studies/issue-153/README.md) - Array.join() pitfall case study
- [docs/case-studies/issue-156/README.md](./docs/case-studies/issue-156/README.md) - try/catch anti-pattern and errexit default behavior
- [src/$.quote.mjs](./src/$.quote.mjs) - Quote function implementation
