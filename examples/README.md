# Command Stream Examples

This directory contains examples demonstrating various features of the command-stream library.

## New Features: Start/Run Options (GitHub Issues #16 & #17)

### **test-start-run-options.mjs**
Comprehensive demonstration of the new `.start()` and `.run()` methods with options.
```bash
node examples/test-start-run-options.mjs
```
- Shows how to pass `capture`, `mirror`, and `stdin` options
- Compares old `sh()` function approach vs new template literal syntax
- Demonstrates performance optimization with `capture: false`

### **test-capture-mirror-combinations.mjs**
Visual demonstration of all capture/mirror option combinations.
```bash
node examples/test-capture-mirror-combinations.mjs
```
- Shows all 4 combinations of capture: true/false, mirror: true/false
- Includes helpful summary table and use case recommendations
- Great for understanding when to use which options

### **test-run-vs-start.mjs**
Compares `.run()` and `.start()` methods to show they are identical.
```bash
node examples/test-run-vs-start.mjs
```
- Performance comparison between the two methods
- Shows both support identical options
- Addresses GitHub issue #16 (`.run()` alias requirement)

### **test-new-features.mjs**
Complete test suite demonstrating the new functionality.
```bash
node examples/test-new-features.mjs
```
- Tests both virtual commands and real shell commands
- Shows backward compatibility with direct await
- Comprehensive option testing

### **test-real-shell.mjs**
Specifically tests the new options with real shell commands (not virtual commands).
```bash
node examples/test-real-shell.mjs
```
- Uses actual system commands like `ls`
- Shows performance differences with different options
- Demonstrates real-world usage scenarios

## ANSI Color Handling Examples

### **interactive-top.mjs** 
Interactive `top` command that preserves ANSI colors and allows full user interaction.
```bash
node examples/interactive-top.mjs
```
- Demonstrates: ANSI color preservation, interactive command support
- Press 'q' to quit when ready

### **example-colors.mjs**
Demonstrates ANSI color handling and processing options.
```bash
node examples/example-colors.mjs  
```
- Shows default ANSI preservation
- Demonstrates `AnsiUtils` for clean data processing
- Shows per-command configuration options

### **example-ansi-ls.mjs** 
Example using `ls` command to show ANSI color handling.
```bash
node examples/example-ansi-ls.mjs
```
- Shows file listing with/without ANSI codes
- Demonstrates byte-level inspection of ANSI sequences

### **example-ansi-comparison.mjs**
Comparison of different ANSI handling approaches.
```bash
node examples/example-ansi-comparison.mjs
```
- Global configuration examples
- Before/after ANSI stripping comparison

### **example-top.mjs**
Simple `top` command example with limited output.
```bash
node examples/example-top.mjs
```
- Non-interactive version for demonstration purposes

### **jq-colors-streaming.mjs**
Demonstrates jq streaming with ANSI color preservation.
```bash
node examples/jq-colors-streaming.mjs
```
- Shows how to force colors in jq pipelines with `--color-output`
- Real-time JSON streaming with color support
- Filtering and transformation examples

### **test-jq-colors.mjs**  
Comprehensive jq color testing and analysis.
```bash
node examples/test-jq-colors.mjs
```
- Tests various jq color scenarios
- Shows raw ANSI byte inspection
- Demonstrates pipeline color preservation

## Stream Cleanup Tests

These examples demonstrate how command-stream properly handles cleanup when breaking from async iteration, especially with infinite streams like the `yes` command:

### test-stream-cleanup.mjs
Full test showing that breaking from a `for await` loop properly stops the underlying process/generator.

```bash
bun examples/test-stream-cleanup.mjs
```

### test-cleanup-simple.mjs
Simplified version focusing on the core cleanup behavior with minimal output.

```bash
bun examples/test-cleanup-simple.mjs
```

### test-debug.mjs
Debug version that shows the internal state (`finished` and `_cancelled` flags) after breaking from iteration.

```bash
bun examples/test-debug.mjs
```

## Key Features Demonstrated

### ANSI Color Handling
- ✅ **ANSI colors preserved by default** (addresses GitHub issue #10)
- ✅ **No interference with interactive I/O** (addresses GitHub issue #11) 
- ✅ **Easy data processing** with `AnsiUtils` export functions
- ✅ **Configurable behavior** for different use cases
- ✅ **Stream compatibility** with existing tools

### Stream Management  
1. **Proper cleanup of infinite streams** - When you break from a `for await` loop iterating over an infinite stream (like `yes`), the underlying process is properly terminated.

2. **No resource leaks** - Virtual commands (async generators) are properly closed when iteration stops.

3. **Clean exit** - No hanging processes or continued output after breaking from iteration.

These examples were crucial in fixing the stream cleanup issue where virtual commands would continue running even after breaking from the iteration loop.