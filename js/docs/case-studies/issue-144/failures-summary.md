# Windows CI Test Failures - Detailed Summary

Run ID: 20541247679
Date: 2025-12-27T16:03:52Z
Platform: Windows Server 2025 (10.0.26100)
Bun Version: 1.3.5

## Complete List of 47 Failed Tests

### 1. Shell/Spawn Failures (ENOENT 'sh')

These failures occur because Windows doesn't have `sh` in the PATH by default:

| Test                                                                                                     | Duration | Error                                             |
| -------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| command-stream Feature Validation > Real-time Streaming > should stream data as it arrives, not buffered | 406ms    | Timing expectation failed (366ms > 50ms expected) |
| ProcessRunner Options > should handle cwd option                                                         | -        | ENOENT: no such file or directory, uv_spawn 'sh'  |
| Synchronous Execution (.sync()) > Options in Sync Mode > should handle cwd option                        | -        | ENOENT: no such file or directory, uv_spawn 'sh'  |

### 2. Command Detection Issues

| Test                                                                                                         | Duration | Error                    |
| ------------------------------------------------------------------------------------------------------------ | -------- | ------------------------ |
| Built-in Commands (Bun.$ compatible) > Command Location (which) > which should find existing system commands | -        | System command not found |
| String interpolation fix for Bun > Shell operators in interpolated commands should work                      | -        | Shell execution failure  |
| Bun-specific shell path tests > Bun.spawn compatibility is maintained                                        | -        | Shell not found          |

### 3. CD Virtual Command Failures

Path handling and quoting issues on Windows:

| Test                                                                                       | Duration | Error                        |
| ------------------------------------------------------------------------------------------ | -------- | ---------------------------- |
| cd Virtual Command - Command Chains > should persist directory change within command chain | 32ms     | Path resolution failure      |
| cd Virtual Command - Command Chains > should handle multiple cd commands in chain          | 31ms     | Path resolution failure      |
| cd Virtual Command - Command Chains > should work with git commands in chain               | 31ms     | Path resolution failure      |
| cd Virtual Command - Edge Cases > should handle cd with trailing slash                     | 32ms     | ENOENT with quoted paths     |
| cd Virtual Command - Edge Cases > should handle cd with multiple slashes                   | 31ms     | ENOENT with multiple slashes |
| Virtual Commands System > Built-in Commands > should execute virtual cd command            | 31ms     | Path handling failure        |

Specific error example:

```
ENOENT: no such file or directory, chdir 'D:\a\command-stream\command-stream\' -> ''C:\Users\RUNNER~1\AppData\Local\Temp\cd-slash-NXM4ex'/'
```

### 4. SIGINT/Signal Handling Failures

Windows handles signals differently than Unix:

| Test                                                                                                            | Duration | Error                     |
| --------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- |
| CTRL+C Baseline Tests (Native Spawn) > should handle Node.js inline script with SIGINT                          | 531ms    | Signal handling failure   |
| CTRL+C Baseline Tests (Native Spawn) > should handle Node.js script file                                        | 1015ms   | Signal handling failure   |
| CTRL+C Different stdin Modes > should handle CTRL+C with string stdin                                           | 5015ms   | **TIMEOUT**               |
| CTRL+C Different stdin Modes > should handle CTRL+C with Buffer stdin                                           | 5016ms   | **TIMEOUT**               |
| CTRL+C Signal Handling > should forward SIGINT to child process when external CTRL+C is sent                    | 3000ms   | Signal not forwarded      |
| CTRL+C Signal Handling > should not interfere with user SIGINT handling when no children active                 | 547ms    | Handler conflict          |
| CTRL+C Signal Handling > should not interfere with child process signal handlers                                | 1031ms   | Handler conflict          |
| CTRL+C with Different stdin Modes > should bypass virtual commands with custom stdin for proper signal handling | 547ms    | Signal handling failure   |
| CTRL+C with Different stdin Modes > should handle Bun vs Node.js signal differences                             | 1047ms   | Platform difference       |
| CTRL+C with Different stdin Modes > should properly cancel virtual commands and respect user SIGINT handlers    | 547ms    | Handler cleanup issue     |
| SIGINT Cleanup Tests (Isolated) > should forward SIGINT to child processes                                      | 547ms    | Signal forwarding failure |

### 5. Git/GH Command Integration Failures

| Test                                                                                                                                          | Duration | Error                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| Git and GH commands with cd virtual command > Git operations in temp directories > should handle git commands in temp directory with cd chain | 31ms     | Path resolution       |
| Git and GH commands with cd virtual command > Git operations in temp directories > should handle git branch operations with cd                | 31ms     | Path resolution       |
| Git and GH commands with cd virtual command > Git operations in temp directories > should handle multiple temp directories with cd            | 47ms     | Path resolution       |
| Git and GH commands with cd virtual command > Git operations in temp directories > should handle git diff operations after cd                 | 47ms     | Path resolution       |
| Git and GH commands with cd virtual command > Combined git and gh workflows > should simulate solve.mjs workflow pattern                      | 5047ms   | **TIMEOUT**           |
| Git and GH commands with cd virtual command > Combined git and gh workflows > should preserve cwd after command chains                        | 1015ms   | CWD not preserved     |
| Git and GH commands with cd virtual command > Combined git and gh workflows > should work with complex git workflows using operators          | 31ms     | Operator failure      |
| Git and GH commands with cd virtual command > Path resolution and quoting with cd > should handle paths with spaces in git operations         | 32ms     | Quote handling        |
| Git and GH commands with cd virtual command > Path resolution and quoting with cd > should handle special characters in paths                 | 31ms     | Special char escaping |

### 6. GitHub CLI (gh) Failures

| Test                                                                                              | Duration | Error           |
| ------------------------------------------------------------------------------------------------- | -------- | --------------- |
| GitHub CLI (gh) commands > gh auth status returns correct exit code and output structure          | 5047ms   | **TIMEOUT**     |
| Examples Execution Tests > should not interfere with user SIGINT handling when no children active | 500ms    | Signal handling |

### 7. jq Streaming Failures

| Test                                                                                      | Duration | Error         |
| ----------------------------------------------------------------------------------------- | -------- | ------------- |
| jq streaming tests > stream of JSON objects through jq -c                                 | 1015ms   | Pipe handling |
| jq streaming tests > generate and process array elements as stream                        | 782ms    | Pipe handling |
| jq streaming with pipe \| syntax > stream of JSON objects through jq -c using pipe syntax | 140ms    | Pipe syntax   |
| jq streaming with pipe \| syntax > process array elements as stream using pipe syntax     | 110ms    | Pipe syntax   |

### 8. Shell Feature Failures

| Test                                                                                                                     | Duration | Error             |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------- |
| Shell Settings (set -e / set +e equivalent) > Shell Replacement Benefits > should provide better error objects than bash | 125ms    | Shell differences |
| Cleanup Verification > should not affect cwd when cd is in subshell                                                      | 406ms    | Subshell handling |
| Options Examples (Feature Demo) > example: real shell command vs virtual command                                         | 16ms     | Shell not found   |

### 9. Output/Streaming Failures

| Test                                                                                                     | Duration | Error               |
| -------------------------------------------------------------------------------------------------------- | -------- | ------------------- |
| Start/Run Edge Cases and Advanced Usage > should work with real shell commands that produce large output | -        | Shell spawn failure |
| Start/Run Options Passing > .start() method with options > should work with real shell commands          | 16ms     | Shell spawn failure |
| Stderr output handling in $.mjs > long-running commands with stderr output should not hang               | 812ms    | Stream handling     |
| streaming interfaces - kill method works                                                                 | 5015ms   | **TIMEOUT**         |

### 10. System Command Piping Failures

| Test                                                                                      | Duration | Error                    |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------ |
| System Command Piping (Issue #8) > Piping to sort > should pipe to sort for sorting lines | 16ms     | sort command differences |
| System Command Piping (Issue #8) > Piping to sort > should handle sort with reverse flag  | 16ms     | sort -r differences      |

## Key Error Messages

### ENOENT Shell Spawn

```
ENOENT: no such file or directory, uv_spawn 'sh'
    path: "sh",
 syscall: "uv_spawn",
   errno: -4058,
    code: "ENOENT"
```

### Path Resolution with Quotes

```
ENOENT: no such file or directory, chdir 'D:\a\command-stream\command-stream\' -> ''C:\Users\RUNNER~1\AppData\Local\Temp\cd-slash-NXM4ex'/'
```

### Signal Handling

```
kill() failed: ESRCH: no such process
```

## Statistics

- **Total failures: 47**
- **Timeout failures: 6** (tests that exceeded 5000ms limit)
- **ENOENT failures: ~20** (shell not found)
- **Signal handling failures: ~11**
- **Path/CD failures: ~10**

## Environment Details

```
Platform: win32
OS: Microsoft Windows Server 2025 10.0.26100
Runner: GitHub Actions windows-latest (windows-2025)
Bun: 1.3.5+1e86cebd7
Git: 2.52.0.windows.1
PowerShell: 7.x available
Git Bash: Available at C:\Program Files\Git\bin\bash.exe
```
