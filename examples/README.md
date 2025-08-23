# Examples

This folder contains example scripts demonstrating various features of command-stream.

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

1. **Proper cleanup of infinite streams** - When you break from a `for await` loop iterating over an infinite stream (like `yes`), the underlying process is properly terminated.

2. **No resource leaks** - Virtual commands (async generators) are properly closed when iteration stops.

3. **Clean exit** - No hanging processes or continued output after breaking from iteration.

These examples were crucial in fixing the stream cleanup issue where virtual commands would continue running even after breaking from the iteration loop.