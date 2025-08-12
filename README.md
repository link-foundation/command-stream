# command-$tream

$treamable commands executor

A modern $ shell utility library with streaming, async iteration, and EventEmitter support, optimized for Bun runtime.

## Features

- 🚀 **Multiple Usage Patterns**: Classic await, async iteration, EventEmitter, and mixed patterns
- 📡 **Real-time Streaming**: Process command output as it arrives, not after completion
- 🔄 **Bun Optimized**: Designed for Bun runtime with Node.js compatibility
- ⚡ **Performance**: Memory-efficient streaming prevents large buffer accumulation
- 🎯 **Backward Compatible**: Existing `await $` syntax continues to work
- 🛡️ **Type Safe**: Full TypeScript support (coming soon)

## Installation

```bash
# Using npm
npm install command-stream

# Using bun
bun add command-stream
```

## Usage Patterns

### 1. Classic Await (Backward Compatible)

```javascript
import { $ } from 'command-stream';

const result = await $`ls -la`;
console.log(result.stdout);
console.log(result.code); // exit code
```

### 2. Async Iteration (Real-time Streaming)

```javascript
import { $ } from 'command-stream';

for await (const chunk of $`long-running-command`.stream()) {
  if (chunk.type === 'stdout') {
    console.log('Real-time output:', chunk.data.toString());
  }
}
```

### 3. EventEmitter Pattern (Event-driven)

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

### 4. Mixed Pattern (Best of Both Worlds)

```javascript
import { $ } from 'command-stream';

const process = $`streaming-command`;

// Handle real-time events
process.on('data', chunk => {
  processRealTimeData(chunk);
});

// Still get the final result
const result = await process;
console.log('Final output:', result.stdout);
```

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
- `then()`, `catch()`, `finally()`: Promise interface for await support

#### Properties

- `stdout`: Direct access to child process stdout stream
- `stderr`: Direct access to child process stderr stream  
- `stdin`: Direct access to child process stdin stream

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

## License

The Unlicense (Public Domain)
