// Global state management for command-stream
// Handles signal handlers, process tracking, and cleanup

import fs from 'fs';
import { trace } from './$.trace.mjs';
import { clearShellCache } from './$.shell.mjs';
import { resetAnsiConfig } from './$.ansi.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

// Save initial working directory for restoration
const initialWorkingDirectory = process.cwd();

// Track parent stream state for graceful shutdown
let parentStreamsMonitored = false;

// Set of active ProcessRunner instances
export const activeProcessRunners = new Set();

// Track if SIGINT handler has been installed
let sigintHandlerInstalled = false;
let sigintHandler = null; // Store reference to remove it later

// Global shell settings
let globalShellSettings = {
  errexit: false, // set -e equivalent: exit on error
  verbose: false, // set -v equivalent: print commands
  xtrace: false, // set -x equivalent: trace execution
  pipefail: false, // set -o pipefail equivalent: pipe failure detection
  nounset: false, // set -u equivalent: error on undefined variables
};

// Virtual commands registry
export const virtualCommands = new Map();
let virtualCommandsEnabled = true;

/**
 * Get the current shell settings
 * @returns {object} Current shell settings
 */
export function getShellSettings() {
  return globalShellSettings;
}

/**
 * Set shell settings
 * @param {object} settings - Settings to apply
 */
export function setShellSettings(settings) {
  globalShellSettings = { ...globalShellSettings, ...settings };
}

/**
 * Reset shell settings to defaults
 */
export function resetShellSettings() {
  globalShellSettings = {
    errexit: false,
    verbose: false,
    xtrace: false,
    pipefail: false,
    nounset: false,
    noglob: false,
    allexport: false,
  };
}

/**
 * Check if virtual commands are enabled
 * @returns {boolean}
 */
export function isVirtualCommandsEnabled() {
  return virtualCommandsEnabled;
}

/**
 * Enable virtual commands
 */
export function enableVirtualCommands() {
  trace('VirtualCommands', () => 'Enabling virtual commands');
  virtualCommandsEnabled = true;
  return virtualCommandsEnabled;
}

/**
 * Disable virtual commands
 */
export function disableVirtualCommands() {
  trace('VirtualCommands', () => 'Disabling virtual commands');
  virtualCommandsEnabled = false;
  return virtualCommandsEnabled;
}

/**
 * Install SIGINT handler for graceful shutdown
 */
export function installSignalHandlers() {
  // Check if our handler is actually installed (not just the flag)
  // This is more robust against test cleanup that manually removes listeners
  const currentListeners = process.listeners('SIGINT');
  const hasOurHandler = currentListeners.some((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') &&
      str.includes('ProcessRunner') &&
      str.includes('activeChildren')
    );
  });

  if (sigintHandlerInstalled && hasOurHandler) {
    trace('SignalHandler', () => 'SIGINT handler already installed, skipping');
    return;
  }

  // Reset flag if handler was removed externally
  if (sigintHandlerInstalled && !hasOurHandler) {
    trace(
      'SignalHandler',
      () => 'SIGINT handler flag was set but handler missing, resetting'
    );
    sigintHandlerInstalled = false;
    sigintHandler = null;
  }

  trace(
    'SignalHandler',
    () =>
      `Installing SIGINT handler | ${JSON.stringify({ activeRunners: activeProcessRunners.size })}`
  );
  sigintHandlerInstalled = true;

  // Forward SIGINT to all active child processes
  // The parent process continues running - it's up to the parent to decide what to do
  sigintHandler = () => {
    // Check for other handlers immediately at the start, before doing any processing
    const currentListeners = process.listeners('SIGINT');
    const hasOtherHandlers = currentListeners.length > 1;

    trace(
      'ProcessRunner',
      () => `SIGINT handler triggered - checking active processes`
    );

    // Count active processes (both child processes and virtual commands)
    const activeChildren = [];
    for (const runner of activeProcessRunners) {
      if (!runner.finished) {
        // Real child process
        if (runner.child && runner.child.pid) {
          activeChildren.push(runner);
          trace(
            'ProcessRunner',
            () =>
              `Found active child: PID ${runner.child.pid}, command: ${runner.spec?.command || 'unknown'}`
          );
        }
        // Virtual command (no child process but still active)
        else if (!runner.child) {
          activeChildren.push(runner);
          trace(
            'ProcessRunner',
            () =>
              `Found active virtual command: ${runner.spec?.command || 'unknown'}`
          );
        }
      }
    }

    trace(
      'ProcessRunner',
      () =>
        `Parent received SIGINT | ${JSON.stringify(
          {
            activeChildrenCount: activeChildren.length,
            hasOtherHandlers,
            platform: process.platform,
            pid: process.pid,
            ppid: process.ppid,
            activeCommands: activeChildren.map((r) => ({
              hasChild: !!r.child,
              childPid: r.child?.pid,
              hasVirtualGenerator: !!r._virtualGenerator,
              finished: r.finished,
              command: r.spec?.command?.slice(0, 30),
            })),
          },
          null,
          2
        )}`
    );

    // Only handle SIGINT if we have active child processes
    // Otherwise, let other handlers or default behavior handle it
    if (activeChildren.length === 0) {
      trace(
        'ProcessRunner',
        () =>
          `No active children - skipping SIGINT forwarding, letting other handlers handle it`
      );
      return; // Let other handlers or default behavior handle it
    }

    trace(
      'ProcessRunner',
      () =>
        `Beginning SIGINT forwarding to ${activeChildren.length} active processes`
    );

    // Forward signal to all active processes (child processes and virtual commands)
    for (const runner of activeChildren) {
      try {
        if (runner.child && runner.child.pid) {
          // Real child process - send SIGINT to it
          trace(
            'ProcessRunner',
            () =>
              `Sending SIGINT to child process | ${JSON.stringify(
                {
                  pid: runner.child.pid,
                  killed: runner.child.killed,
                  runtime: isBun ? 'Bun' : 'Node.js',
                  command: runner.spec?.command?.slice(0, 50),
                },
                null,
                2
              )}`
          );

          if (isBun) {
            runner.child.kill('SIGINT');
            trace(
              'ProcessRunner',
              () => `Bun: SIGINT sent to PID ${runner.child.pid}`
            );
          } else {
            // Send to process group if detached, otherwise to process directly
            try {
              process.kill(-runner.child.pid, 'SIGINT');
              trace(
                'ProcessRunner',
                () =>
                  `Node.js: SIGINT sent to process group -${runner.child.pid}`
              );
            } catch (err) {
              trace(
                'ProcessRunner',
                () =>
                  `Node.js: Process group kill failed, trying direct: ${err.message}`
              );
              process.kill(runner.child.pid, 'SIGINT');
              trace(
                'ProcessRunner',
                () => `Node.js: SIGINT sent directly to PID ${runner.child.pid}`
              );
            }
          }
        } else {
          // Virtual command - cancel it using the runner's kill method
          trace(
            'ProcessRunner',
            () =>
              `Cancelling virtual command | ${JSON.stringify(
                {
                  hasChild: !!runner.child,
                  hasVirtualGenerator: !!runner._virtualGenerator,
                  finished: runner.finished,
                  cancelled: runner._cancelled,
                  command: runner.spec?.command?.slice(0, 50),
                },
                null,
                2
              )}`
          );
          runner.kill('SIGINT');
          trace('ProcessRunner', () => `Virtual command kill() called`);
        }
      } catch (err) {
        trace(
          'ProcessRunner',
          () =>
            `Error in SIGINT handler for runner | ${JSON.stringify(
              {
                error: err.message,
                stack: err.stack?.slice(0, 300),
                hasPid: !!(runner.child && runner.child.pid),
                pid: runner.child?.pid,
                command: runner.spec?.command?.slice(0, 50),
              },
              null,
              2
            )}`
        );
      }
    }

    // We've forwarded SIGINT to all active processes/commands
    // Use the hasOtherHandlers flag we calculated at the start (before any processing)
    trace(
      'ProcessRunner',
      () =>
        `SIGINT forwarded to ${activeChildren.length} active processes, other handlers: ${hasOtherHandlers}`
    );

    if (!hasOtherHandlers) {
      // No other handlers - we should exit like a proper shell
      trace(
        'ProcessRunner',
        () => `No other SIGINT handlers, exiting with code 130`
      );
      // Ensure stdout/stderr are flushed before exiting
      if (process.stdout && typeof process.stdout.write === 'function') {
        process.stdout.write('', () => {
          process.exit(130); // 128 + 2 (SIGINT)
        });
      } else {
        process.exit(130); // 128 + 2 (SIGINT)
      }
    } else {
      // Other handlers exist - let them handle the exit completely
      // Do NOT call process.exit() ourselves when other handlers are present
      trace(
        'ProcessRunner',
        () =>
          `Other SIGINT handlers present, letting them handle the exit completely`
      );
    }
  };

  process.on('SIGINT', sigintHandler);
}

/**
 * Uninstall SIGINT handler
 */
export function uninstallSignalHandlers() {
  if (!sigintHandlerInstalled || !sigintHandler) {
    trace(
      'SignalHandler',
      () => 'SIGINT handler not installed or missing, skipping removal'
    );
    return;
  }

  trace(
    'SignalHandler',
    () =>
      `Removing SIGINT handler | ${JSON.stringify({ activeRunners: activeProcessRunners.size })}`
  );
  process.removeListener('SIGINT', sigintHandler);
  sigintHandlerInstalled = false;
  sigintHandler = null;
}

/**
 * Force cleanup of all command-stream SIGINT handlers and state - for testing
 */
export function forceCleanupAll() {
  // Remove all command-stream SIGINT handlers
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren')
    );
  });

  commandStreamListeners.forEach((listener) => {
    process.removeListener('SIGINT', listener);
  });

  // Clear activeProcessRunners
  activeProcessRunners.clear();

  // Reset signal handler flags
  sigintHandlerInstalled = false;
  sigintHandler = null;

  trace(
    'SignalHandler',
    () =>
      `Force cleanup completed - removed ${commandStreamListeners.length} handlers`
  );
}

/**
 * Monitor parent streams for graceful shutdown
 */
export function monitorParentStreams() {
  if (parentStreamsMonitored) {
    trace('StreamMonitor', () => 'Parent streams already monitored, skipping');
    return;
  }
  trace('StreamMonitor', () => 'Setting up parent stream monitoring');
  parentStreamsMonitored = true;

  const checkParentStream = (stream, name) => {
    if (stream && typeof stream.on === 'function') {
      stream.on('close', () => {
        trace(
          'ProcessRunner',
          () =>
            `Parent ${name} closed - triggering graceful shutdown | ${JSON.stringify({ activeProcesses: activeProcessRunners.size }, null, 2)}`
        );
        for (const runner of activeProcessRunners) {
          if (runner._handleParentStreamClosure) {
            runner._handleParentStreamClosure();
          }
        }
      });
    }
  };

  checkParentStream(process.stdout, 'stdout');
  checkParentStream(process.stderr, 'stderr');
}

/**
 * Reset parent stream monitoring flag (for testing)
 */
export function resetParentStreamMonitoring() {
  parentStreamsMonitored = false;
}

/**
 * Complete global state reset for testing - clears all library state
 */
export function resetGlobalState() {
  // CRITICAL: Restore working directory first before anything else
  // This MUST succeed or tests will fail with spawn errors
  try {
    // Try to get current directory - this might fail if we're in a deleted directory
    let currentDir;
    try {
      currentDir = process.cwd();
    } catch (e) {
      // Can't even get cwd, we're in a deleted directory
      currentDir = null;
    }

    // Always try to restore to initial directory
    if (!currentDir || currentDir !== initialWorkingDirectory) {
      // Check if initial directory still exists
      if (fs.existsSync(initialWorkingDirectory)) {
        process.chdir(initialWorkingDirectory);
        trace(
          'GlobalState',
          () =>
            `Restored working directory from ${currentDir} to ${initialWorkingDirectory}`
        );
      } else {
        // Initial directory is gone, use fallback
        const fallback = process.env.HOME || '/workspace/command-stream' || '/';
        if (fs.existsSync(fallback)) {
          process.chdir(fallback);
          trace(
            'GlobalState',
            () => `Initial directory gone, changed to fallback: ${fallback}`
          );
        } else {
          // Last resort - try root
          process.chdir('/');
          trace('GlobalState', () => `Emergency fallback to root directory`);
        }
      }
    }
  } catch (e) {
    trace(
      'GlobalState',
      () => `Critical error restoring working directory: ${e.message}`
    );
    // This is critical - we MUST have a valid working directory
    try {
      // Try home directory
      if (process.env.HOME && fs.existsSync(process.env.HOME)) {
        process.chdir(process.env.HOME);
      } else {
        // Last resort - root
        process.chdir('/');
      }
    } catch (e2) {
      console.error('FATAL: Cannot set any working directory!', e2);
    }
  }

  // First, properly clean up all active ProcessRunners
  for (const runner of activeProcessRunners) {
    if (runner) {
      try {
        // If the runner was never started, clean it up
        if (!runner.started) {
          trace(
            'resetGlobalState',
            () =>
              `Cleaning up unstarted ProcessRunner: ${runner.spec?.command?.slice(0, 50)}`
          );
          // Call the cleanup method to properly release resources
          if (runner._cleanup) {
            runner._cleanup();
          }
        } else if (runner.kill) {
          // For started runners, kill them
          runner.kill();
        }
      } catch (e) {
        // Ignore errors
        trace('resetGlobalState', () => `Error during cleanup: ${e.message}`);
      }
    }
  }

  // Call existing cleanup
  forceCleanupAll();

  // Clear shell cache to force re-detection with our fixed logic
  clearShellCache();

  // Reset parent stream monitoring
  parentStreamsMonitored = false;

  // Reset shell settings to defaults
  resetShellSettings();

  // Don't clear virtual commands - they should persist across tests
  // Just make sure they're enabled
  virtualCommandsEnabled = true;

  // Reset ANSI config to defaults
  resetAnsiConfig();

  // Make sure built-in virtual commands are registered
  if (virtualCommands.size === 0) {
    // Re-import to re-register commands (synchronously if possible)
    trace('GlobalState', () => 'Re-registering virtual commands');
    import('./commands/index.mjs')
      .then(() => {
        trace(
          'GlobalState',
          () => `Virtual commands re-registered, count: ${virtualCommands.size}`
        );
      })
      .catch((e) => {
        trace(
          'GlobalState',
          () => `Error re-registering virtual commands: ${e.message}`
        );
      });
  }

  trace('GlobalState', () => 'Global state reset completed');
}
