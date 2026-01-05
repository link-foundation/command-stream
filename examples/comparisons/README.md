# Command-Stream: Node.js vs Bun.js Comparison Examples

This directory contains comprehensive examples showing how each command-stream feature works identically in both Node.js and Bun.js runtimes.

## 🎯 Ultimate Runtime Comparison

Each example demonstrates the **exact same code** working perfectly in both runtimes, showcasing command-stream's cross-runtime compatibility.

## 📁 Example Categories

### 1. **Basic Usage Patterns**
- `01-basic-await-comparison.mjs` - Classic await pattern
- `02-async-iteration-comparison.mjs` - Real-time streaming with async iteration
- `03-eventemitter-comparison.mjs` - Event-driven pattern

### 2. **Streaming Interfaces** 
- `04-streaming-stdin-comparison.mjs` - Real-time stdin control
- `05-streaming-buffers-comparison.mjs` - Buffer access
- `06-streaming-strings-comparison.mjs` - String access

### 3. **Built-in Commands**
- `07-builtin-filesystem-comparison.mjs` - Cross-platform file operations
- `08-builtin-utilities-comparison.mjs` - Utility commands (basename, dirname, seq)
- `09-builtin-system-comparison.mjs` - System commands (echo, pwd, env)

### 4. **Virtual Commands**
- `10-virtual-basic-comparison.mjs` - Custom JavaScript commands
- `11-virtual-streaming-comparison.mjs` - Streaming virtual commands
- `12-virtual-pipeline-comparison.mjs` - Virtual commands in pipelines

### 5. **Pipeline Support**
- `13-pipeline-system-comparison.mjs` - System command pipelines
- `14-pipeline-builtin-comparison.mjs` - Built-in command pipelines  
- `15-pipeline-mixed-comparison.mjs` - Mixed command type pipelines

### 6. **Options & Configuration**
- `16-options-environment-comparison.mjs` - Custom environments
- `17-options-directory-comparison.mjs` - Working directory control
- `18-options-stdin-comparison.mjs` - Stdin handling

### 7. **Execution Control**
- `19-execution-sync-comparison.mjs` - Synchronous execution
- `20-execution-async-comparison.mjs` - Asynchronous execution modes

### 8. **Signal Handling**
- `21-signals-sigint-comparison.mjs` - SIGINT forwarding
- `22-signals-cleanup-comparison.mjs` - Process cleanup

### 9. **Security Features**
- `23-security-quoting-comparison.mjs` - Smart auto-quoting
- `24-security-injection-comparison.mjs` - Injection protection

### 10. **Shell Replacement**
- `25-shell-errexit-comparison.mjs` - Error handling (set -e/+e)
- `26-shell-verbose-comparison.mjs` - Verbose mode (set -x/+x)

## 🚀 Running Examples

Each example can be run with either runtime:

```bash
# Run with Node.js
node examples/comparisons/01-basic-await-comparison.mjs

# Run with Bun
bun examples/comparisons/01-basic-await-comparison.mjs
```

## 🔧 Runtime Detection

All examples include runtime detection to show which environment they're running in:

```javascript
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
```

## 📊 Performance Notes

- **Bun**: Generally faster startup and execution
- **Node.js**: Broader ecosystem compatibility
- **command-stream**: Identical API and behavior in both runtimes

## 🎯 Key Takeaway

**Every single feature works identically in both runtimes** - that's the power of command-stream's cross-runtime design!