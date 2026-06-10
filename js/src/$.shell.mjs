// Shell detection utilities for command-stream
// Handles cross-platform shell detection and caching

import cp from 'child_process';
import fs from 'fs';
import os from 'os';
import { trace } from './$.trace.mjs';

// Shell detection cache
let cachedShell = null;

/**
 * Pick a directory that is known to exist for spawning a child process.
 * @returns {string} An existing fallback directory
 */
function spawnFallbackDir() {
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    os.tmpdir(),
    '/',
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore and try the next candidate.
    }
  }
  return os.tmpdir();
}

/**
 * Resolve a working directory that is safe to spawn a child process in.
 *
 * When no explicit cwd is requested the child normally inherits the parent's
 * working directory. But if that directory has been deleted or become
 * inaccessible (the "getcwd() failed" scenario from issue #44), inheriting it
 * makes the OS-level spawn fail with `ENOENT: ... posix_spawn` on Linux and a
 * similar error on Windows. In that case fall back to a directory that is known
 * to exist so the command still runs.
 *
 * Note: `process.cwd()` does not reliably throw when the working directory has
 * been deleted — under Bun (and on some platforms) it returns a stale path that
 * no longer exists on disk. So validity is checked with `fs.existsSync()`
 * rather than by relying on `process.cwd()` to throw.
 *
 * Normal behavior is preserved: when an explicit, existing cwd is given, or
 * when the inherited working directory is valid, this returns the original
 * value (including `undefined`, meaning "inherit").
 *
 * @param {string|undefined|null} cwd - Requested working directory
 * @returns {string|undefined} A spawn-safe working directory
 */
export function resolveSpawnCwd(cwd) {
  // An explicit directory is honored only when it actually exists on disk;
  // otherwise the spawn would fail, so fall back to a known-good directory.
  if (cwd) {
    try {
      if (fs.existsSync(cwd)) {
        return cwd;
      }
    } catch {
      // Fall through to the fallback below.
    }
    const fallback = spawnFallbackDir();
    trace(
      'ProcessRunner',
      () =>
        `Requested cwd "${cwd}" is not accessible; spawning in fallback directory ${fallback}`
    );
    return fallback;
  }

  // No explicit cwd: the child would inherit the parent's working directory.
  // Make sure that directory actually exists before relying on inheritance.
  let current;
  try {
    current = process.cwd();
  } catch (e) {
    const fallback = spawnFallbackDir();
    trace(
      'ProcessRunner',
      () =>
        `process.cwd() failed (${e.message}); spawning in fallback directory ${fallback}`
    );
    return fallback;
  }

  try {
    if (current && fs.existsSync(current)) {
      // Inherited directory is valid: preserve "inherit" semantics.
      return cwd;
    }
  } catch {
    // Fall through to the fallback below.
  }

  const fallback = spawnFallbackDir();
  trace(
    'ProcessRunner',
    () =>
      `Inherited working directory "${current}" no longer exists; spawning in fallback directory ${fallback}`
  );
  return fallback;
}

/**
 * Find an available shell by checking multiple options in order
 * Returns the shell command and arguments to use
 * @returns {{ cmd: string, args: string[] }} Shell command and arguments
 */
export function findAvailableShell() {
  if (cachedShell) {
    trace('ShellDetection', () => `Using cached shell: ${cachedShell.cmd}`);
    return cachedShell;
  }

  const isWindows = process.platform === 'win32';

  // Windows-specific shells
  const windowsShells = [
    // Git Bash is the most Unix-compatible option on Windows
    // Check common installation paths
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
    {
      cmd: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      args: ['-c'],
      checkPath: true,
    },
    // Git Bash via PATH (if added to PATH by user)
    { cmd: 'bash.exe', args: ['-c'], checkPath: false },
    // WSL bash as fallback
    { cmd: 'wsl.exe', args: ['bash', '-c'], checkPath: false },
    // PowerShell as last resort (different syntax for commands)
    { cmd: 'powershell.exe', args: ['-Command'], checkPath: false },
    { cmd: 'pwsh.exe', args: ['-Command'], checkPath: false },
    // cmd.exe as final fallback
    { cmd: 'cmd.exe', args: ['/c'], checkPath: false },
  ];

  // Unix-specific shells
  const unixShells = [
    // Try absolute paths first (most reliable)
    { cmd: '/bin/sh', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/bin/sh', args: ['-l', '-c'], checkPath: true },
    { cmd: '/bin/bash', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/bin/bash', args: ['-l', '-c'], checkPath: true },
    { cmd: '/bin/zsh', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/bin/zsh', args: ['-l', '-c'], checkPath: true },
    // macOS specific paths
    { cmd: '/usr/local/bin/bash', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/local/bin/zsh', args: ['-l', '-c'], checkPath: true },
    // Linux brew paths
    {
      cmd: '/home/linuxbrew/.linuxbrew/bin/bash',
      args: ['-l', '-c'],
      checkPath: true,
    },
    {
      cmd: '/home/linuxbrew/.linuxbrew/bin/zsh',
      args: ['-l', '-c'],
      checkPath: true,
    },
    // Try shells in PATH as fallback (which might not work in all environments)
    // Using separate -l and -c flags for better compatibility
    { cmd: 'sh', args: ['-l', '-c'], checkPath: false },
    { cmd: 'bash', args: ['-l', '-c'], checkPath: false },
    { cmd: 'zsh', args: ['-l', '-c'], checkPath: false },
  ];

  // Select shells based on platform
  const shellsToTry = isWindows ? windowsShells : unixShells;

  for (const shell of shellsToTry) {
    try {
      if (shell.checkPath) {
        // Check if the absolute path exists
        if (fs.existsSync(shell.cmd)) {
          trace(
            'ShellDetection',
            () => `Found shell at absolute path: ${shell.cmd}`
          );
          cachedShell = { cmd: shell.cmd, args: shell.args };
          return cachedShell;
        }
      } else {
        // On Windows, use 'where' instead of 'which'
        const whichCmd = isWindows ? 'where' : 'which';
        const result = cp.spawnSync(whichCmd, [shell.cmd], {
          encoding: 'utf-8',
          // On Windows, we need shell: true for 'where' to work
          shell: isWindows,
        });
        if (result.status === 0 && result.stdout) {
          const shellPath = result.stdout.trim().split('\n')[0]; // Take first result
          trace(
            'ShellDetection',
            () => `Found shell in PATH: ${shell.cmd} => ${shellPath}`
          );
          cachedShell = { cmd: shell.cmd, args: shell.args };
          return cachedShell;
        }
      }
    } catch (e) {
      // Continue to next shell option
      trace(
        'ShellDetection',
        () => `Failed to check shell ${shell.cmd}: ${e.message}`
      );
    }
  }

  // Final fallback based on platform
  if (isWindows) {
    trace(
      'ShellDetection',
      () => 'WARNING: No shell found, using cmd.exe as fallback on Windows'
    );
    cachedShell = { cmd: 'cmd.exe', args: ['/c'] };
  } else {
    trace(
      'ShellDetection',
      () => 'WARNING: No shell found, using /bin/sh as fallback'
    );
    cachedShell = { cmd: '/bin/sh', args: ['-l', '-c'] };
  }
  return cachedShell;
}

/**
 * Clear the shell cache (useful for testing)
 */
export function clearShellCache() {
  cachedShell = null;
  trace('ShellDetection', () => 'Shell cache cleared');
}

/**
 * Get the currently cached shell (if any)
 * @returns {{ cmd: string, args: string[] } | null}
 */
export function getCachedShell() {
  return cachedShell;
}
