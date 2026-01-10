# Best Practices for command-stream

This document covers best practices, common patterns, and pitfalls to avoid when using the command-stream library.

## Table of Contents

- [Array Argument Handling](#array-argument-handling)
- [String Interpolation](#string-interpolation)
- [Security Best Practices](#security-best-practices)
- [Error Handling](#error-handling)
- [Performance Tips](#performance-tips)
- [Common Pitfalls](#common-pitfalls)

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

See [Case Study: Issue #153](docs/case-studies/issue-153/README.md) for detailed analysis.

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

---

## See Also

- [README.md](README.md) - Main documentation
- [docs/case-studies/issue-153/README.md](docs/case-studies/issue-153/README.md) - Array.join() pitfall case study
- [js/src/$.quote.mjs](js/src/$.quote.mjs) - Quote function implementation
