# Case Study: Windows CI Test Failures (Issue #144)

## Summary

This document provides a comprehensive analysis of the Windows test failures in the command-stream library's CI pipeline, including timeline of events, root causes, and proposed solutions.

## Timeline of Events

### December 27, 2025

1. **14:53:56 UTC** - PR #143 created to transition to new CI/CD template with modern best practices
2. **15:12:12 UTC** - First commit with Windows tests enabled in CI matrix
3. **15:12:26 UTC** - First Windows test failures detected (Run ID: 20540726833)
4. **15:17:47 UTC** - macOS and Windows tests temporarily disabled due to platform issues
5. **15:20:13 UTC** - macOS tests were re-enabled after symlink resolution fixes
6. **16:03:39 UTC** - Cross-platform CI re-enabled, but Windows tests fail again
7. **16:13:42 UTC** - Windows tests disabled again pending path separator fixes
8. **16:24:10 UTC** - PR #143 merged with Windows tests disabled
9. **18:17:18 UTC** - Issue #144 created to track Windows CI fixes

## Test Execution Results (Windows)

From CI Run 20541247679 (2025-12-27T16:03:52Z):

| Metric      | Count   |
| ----------- | ------- |
| Total tests | 647     |
| Passed      | 595     |
| Failed      | 47      |
| Skipped     | 5       |
| Errors      | 2       |
| Duration    | 175.88s |

### Success Rate: 91.96% (595/647)

## Root Cause Analysis

### Primary Issue: Shell Detection Failure

The core problem is that the `findAvailableShell()` function in `src/$.mjs` only looks for Unix-style shells:

```javascript
const shellsToTry = [
  { cmd: '/bin/sh', args: ['-l', '-c'], checkPath: true },
  { cmd: '/usr/bin/sh', args: ['-l', '-c'], checkPath: true },
  { cmd: '/bin/bash', args: ['-l', '-c'], checkPath: true },
  // ... more Unix paths
  { cmd: 'sh', args: ['-l', '-c'], checkPath: false },
  { cmd: 'bash', args: ['-l', '-c'], checkPath: false },
];
```

On Windows, these paths don't exist, leading to:

```
ENOENT: no such file or directory, uv_spawn 'sh'
```

### Secondary Issues

1. **Path Separator Differences**
   - Windows uses backslashes (`\`) vs Unix forward slashes (`/`)
   - Some tests with hardcoded paths fail due to this mismatch

2. **Signal Handling (SIGINT)**
   - Windows handles process signals differently than Unix
   - CTRL+C behavior is platform-specific
   - Many signal-related tests timeout or fail

3. **Temp Directory Paths**
   - Windows uses `C:\Users\RUNNER~1\AppData\Local\Temp\` format
   - Short path notation (8.3) can cause issues with path matching

4. **Timing Differences**
   - Windows process spawning is slower
   - Test expectations like `expect(timeToFirstChunk).toBeLessThan(50)` fail
   - Actual value: 366ms vs expected <50ms

## Failed Tests Categories

### Category 1: Shell Spawn Failures (ENOENT 'sh')

- ProcessRunner Options > should handle cwd option
- Synchronous Execution (.sync()) > Options in Sync Mode > should handle cwd option
- Start/Run Options Passing > .start() method with options > should work with real shell commands
- Options Examples (Feature Demo) > example: real shell command vs virtual command
- And many more shell-dependent tests

### Category 2: Path/CD Command Issues

- cd Virtual Command - Command Chains > should persist directory change within command chain
- cd Virtual Command - Edge Cases > should handle cd with trailing slash
- cd Virtual Command - Edge Cases > should handle cd with multiple slashes
- Virtual Commands System > Built-in Commands > should execute virtual cd command

### Category 3: Signal Handling Timeouts

- CTRL+C Signal Handling > should forward SIGINT to child process
- CTRL+C Different stdin Modes > should handle CTRL+C with string stdin
- CTRL+C with Different stdin Modes > should bypass virtual commands with custom stdin
- streaming interfaces - kill method works

### Category 4: Timing-Sensitive Tests

- command-stream Feature Validation > Real-time Streaming > should stream data as it arrives

### Category 5: Platform-Specific Commands

- Built-in Commands > Command Location (which) > which should find existing system commands
- System Command Piping (Issue #8) > Piping to sort > should pipe to sort for sorting lines

## Proposed Solutions

### Solution 1: Add Windows Shell Detection (Required)

Add Windows shells to `findAvailableShell()`:

```javascript
const shellsToTry = [
  // Windows shells (check first on Windows)
  ...(process.platform === 'win32'
    ? [
        { cmd: 'cmd.exe', args: ['/c'], checkPath: false },
        { cmd: 'powershell.exe', args: ['-Command'], checkPath: false },
        { cmd: 'pwsh.exe', args: ['-Command'], checkPath: false },
        // Git Bash (most compatible)
        {
          cmd: 'C:\\Program Files\\Git\\bin\\bash.exe',
          args: ['-c'],
          checkPath: true,
        },
        {
          cmd: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          args: ['-c'],
          checkPath: true,
        },
      ]
    : []),
  // Unix shells
  { cmd: '/bin/sh', args: ['-l', '-c'], checkPath: true },
  // ... rest of Unix shells
];
```

### Solution 2: Path Normalization Helper

Create a cross-platform path normalization function:

```javascript
function normalizePath(p) {
  if (process.platform === 'win32') {
    // Convert forward slashes to backslashes for Windows
    // Handle UNC paths and drive letters
    return path.normalize(p);
  }
  return p;
}
```

### Solution 3: Skip/Adjust Platform-Specific Tests

Add platform checks to inherently Unix-specific tests:

```javascript
test.skipIf(process.platform === 'win32')(
  'should forward SIGINT...',
  async () => {
    // Unix-specific signal handling
  }
);
```

### Solution 4: Increase Timing Tolerances

Adjust timing expectations for Windows:

```javascript
const MAX_FIRST_CHUNK_TIME = process.platform === 'win32' ? 500 : 50;
expect(timeToFirstChunk).toBeLessThan(MAX_FIRST_CHUNK_TIME);
```

## Recommendation

Given the complexity of full Windows support, I recommend a phased approach:

### Phase 1: Quick Wins (This PR)

1. Add basic Windows shell detection with Git Bash fallback
2. Skip tests that are fundamentally incompatible with Windows
3. Document Windows limitations in README

### Phase 2: Future Work

1. Implement full cross-platform path handling
2. Add Windows-specific virtual command implementations
3. Create Windows-specific test configurations

## Files Changed/To Be Changed

| File                            | Change Type | Description                     |
| ------------------------------- | ----------- | ------------------------------- |
| `src/$.mjs`                     | Modified    | Add Windows shell detection     |
| `tests/*.test.mjs`              | Modified    | Add platform-specific skips     |
| `.github/workflows/release.yml` | Modified    | Re-enable Windows in CI matrix  |
| `README.md`                     | Modified    | Document Windows support status |

## References

- GitHub Actions Run: https://github.com/link-foundation/command-stream/actions/runs/20541247679
- PR #143: https://github.com/link-foundation/command-stream/pull/143
- Issue #144: https://github.com/link-foundation/command-stream/issues/144

## Appendix: Full Failure List

See `failures-summary.md` for the complete list of 47 failed tests with error details.
