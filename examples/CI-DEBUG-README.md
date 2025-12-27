# CI Debugging Examples

This directory contains examples for debugging common issues that occur in CI environments when testing command execution libraries.

## Common CI Issues and Solutions

### 1. Stdout Buffering (`ci-debug-stdout-buffering.mjs`)

**Problem**: Output doesn't appear immediately in CI (non-TTY environments) due to stdout buffering.

**Solution**: Force stdout flush when not in TTY mode.

```bash
node examples/ci-debug-stdout-buffering.mjs
```

### 2. ES Module Loading Failures (`ci-debug-es-module-loading.mjs`)

**Problem**: Child processes with ES module imports fail immediately with SIGINT in CI.

**Solution**: Use different module loading strategies or fallback to shell commands.

```bash
node examples/ci-debug-es-module-loading.mjs
```

### 3. Signal Handling (`ci-debug-signal-handling.mjs`)

**Problem**: SIGINT/SIGTERM signals behave differently in CI, especially with process groups.

**Solution**: Proper signal forwarding and environment-aware cleanup strategies.

```bash
node examples/ci-debug-signal-handling.mjs
```

### 4. Test Timeouts (`ci-debug-test-timeouts.mjs`)

**Problem**: Tests hang indefinitely without proper timeout configuration.

**Solution**: Add explicit timeouts to all tests and implement timeout strategies.

```bash
node examples/ci-debug-test-timeouts.mjs
```

### 5. Baseline vs Library Testing (`ci-debug-baseline-vs-library.mjs`)

**Problem**: Need to determine if failures are due to the library or underlying Node.js behavior.

**Solution**: Test both raw spawn and library functionality for comparison.

```bash
node examples/ci-debug-baseline-vs-library.mjs
```

## Quick Debugging Checklist

When tests fail in CI but pass locally:

1. **Check stdout buffering**: Is output being buffered in non-TTY mode?
2. **Check module loading**: Are ES modules failing to load in child processes?
3. **Check signal handling**: Are signals being properly forwarded?
4. **Check timeouts**: Do all tests have appropriate timeouts?
5. **Check environment**: What's different between CI and local (TTY, env vars, etc.)?

## Environment Detection

```javascript
const isCI = process.env.CI === 'true';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const isTTY = process.stdout.isTTY;
```

## Common Fixes

### Force Stdout Flush

```javascript
process.stdout.write('output\n');
if (!process.stdout.isTTY) {
  process.stdout.write('', () => {}); // Force flush
}
```

### Add Test Timeouts (Bun)

```javascript
test('my test', async () => {
  // test code
}, 30000); // 30 second timeout
```

### Fallback to Shell Commands

```javascript
// Instead of spawning Node with ES modules
spawn('sh', ['-c', 'echo "test"'], { stdio: 'inherit' });
```

### Proper Signal Cleanup

```javascript
const cleanup = () => {
  children.forEach((child) => child.kill('SIGTERM'));
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
```

## Running All CI Debug Examples

```bash
# Run all CI debugging examples
for f in examples/ci-debug-*.mjs; do
  echo "Running $f..."
  node "$f"
  echo ""
done
```

## Tips for CI Testing

1. **Always add timeouts** to prevent infinite hangs
2. **Use environment detection** to adjust behavior for CI
3. **Test both baseline and library** to isolate issues
4. **Add extensive logging** with timestamps in CI mode
5. **Handle signals properly** with cleanup on exit
6. **Force output flushing** in non-TTY environments
7. **Use simple shell commands** as fallback when ES modules fail

## Related Test Files

- `tests/ctrl-c-baseline.test.mjs` - Baseline spawn tests
- `tests/ctrl-c-library.test.mjs` - Library-specific tests
- `tests/ctrl-c-signal.test.mjs` - Signal handling tests
- `tests/cleanup-verification.test.mjs` - Resource cleanup tests
