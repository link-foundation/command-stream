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

// Global shell settings (use a proxy for modules that need direct property access)
const globalShellSettings = {
  errexit: false, // set -e equivalent: exit on error
  verbose: false, // set -v equivalent: print commands
  xtrace: false, // set -x equivalent: trace execution
  pipefail: false, // set -o pipefail equivalent: pipe failure detection
  nounset: false, // set -u equivalent: error on undefined variables
};

// Export the globalShellSettings object
export { globalShellSettings };

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
  Object.assign(globalShellSettings, settings);
}

/**
 * Reset shell settings to defaults
 */
export function resetShellSettings() {
  globalShellSettings.errexit = false;
  globalShellSettings.verbose = false;
  globalShellSettings.xtrace = false;
  globalShellSettings.pipefail = false;
  globalShellSettings.nounset = false;
  globalShellSettings.noglob = false;
  globalShellSettings.allexport = false;
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
 * Find active runners (child processes and virtual commands)
 * @returns {Array} Active runners
 */
function findActiveRunners() {
  const activeChildren = [];
  for (const runner of activeProcessRunners) {
    if (!runner.finished) {
      if (runner.child && runner.child.pid) {
        activeChildren.push(runner);
      } else if (!runner.child) {
        activeChildren.push(runner);
      }
    }
  }
  return activeChildren;
}

/**
 * Send SIGINT to a child process
 * @param {object} runner - ProcessRunner instance
 */
function sendSigintToChild(runner) {
  trace('ProcessRunner', () => `Sending SIGINT to child ${runner.child.pid}`);
  if (isBun) {
    runner.child.kill('SIGINT');
  } else {
    try {
      process.kill(-runner.child.pid, 'SIGINT');
    } catch (_err) {
      process.kill(runner.child.pid, 'SIGINT');
    }
  }
}

/**
 * Forward SIGINT to all active runners
 * @param {Array} activeChildren - Active runners to signal
 */
function forwardSigintToRunners(activeChildren) {
  for (const runner of activeChildren) {
    try {
      if (runner.child && runner.child.pid) {
        sendSigintToChild(runner);
      } else {
        trace('ProcessRunner', () => 'Cancelling virtual command');
        runner.kill('SIGINT');
      }
    } catch (err) {
      trace('ProcessRunner', () => `Error forwarding SIGINT: ${err.message}`);
    }
  }
}

/**
 * Handle exit after SIGINT forwarding
 * @param {boolean} hasOtherHandlers - Whether other handlers exist
 * @param {number} activeCount - Number of active children
 */
function handleSigintExit(hasOtherHandlers, activeCount) {
  trace('ProcessRunner', () => `SIGINT forwarded to ${activeCount} processes`);
  if (!hasOtherHandlers) {
    trace('ProcessRunner', () => 'No other handlers, exiting with code 130');
    if (process.stdout && typeof process.stdout.write === 'function') {
      process.stdout.write('', () => process.exit(130));
    } else {
      process.exit(130);
    }
  }
}

/**
 * Check if our handler is installed
 * @returns {boolean}
 */
function isOurHandlerInstalled() {
  const currentListeners = process.listeners('SIGINT');
  return currentListeners.some((l) => {
    const str = l.toString();
    // Look for our unique marker or helper function names
    return (
      str.includes('findActiveRunners') ||
      str.includes('forwardSigintToRunners') ||
      str.includes('handleSigintExit') ||
      // Legacy detection for backwards compatibility
      (str.includes('activeProcessRunners') &&
        str.includes('ProcessRunner') &&
        str.includes('activeChildren'))
    );
  });
}

/**
 * Install SIGINT handler for graceful shutdown
 */
export function installSignalHandlers() {
  const hasOurHandler = isOurHandlerInstalled();

  if (sigintHandlerInstalled && hasOurHandler) {
    return;
  }

  if (sigintHandlerInstalled && !hasOurHandler) {
    sigintHandlerInstalled = false;
    sigintHandler = null;
  }

  trace('SignalHandler', () => `Installing SIGINT handler`);
  sigintHandlerInstalled = true;

  sigintHandler = () => {
    const hasOtherHandlers = process.listeners('SIGINT').length > 1;
    const activeChildren = findActiveRunners();

    if (activeChildren.length === 0) {
      return;
    }

    forwardSigintToRunners(activeChildren);
    handleSigintExit(hasOtherHandlers, activeChildren.length);
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
 * Check if a listener is a command-stream SIGINT handler
 * @param {Function} listener - Listener function
 * @returns {boolean}
 */
function isCommandStreamListener(listener) {
  const str = listener.toString();
  return (
    str.includes('findActiveRunners') ||
    str.includes('forwardSigintToRunners') ||
    str.includes('handleSigintExit') ||
    str.includes('activeProcessRunners') ||
    str.includes('ProcessRunner') ||
    str.includes('activeChildren')
  );
}

/**
 * Force cleanup of all command-stream SIGINT handlers and state - for testing
 */
export function forceCleanupAll() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter(
    isCommandStreamListener
  );

  commandStreamListeners.forEach((listener) => {
    process.removeListener('SIGINT', listener);
  });

  activeProcessRunners.clear();
  sigintHandlerInstalled = false;
  sigintHandler = null;

  trace('SignalHandler', () => `Force cleanup completed`);
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
 * Get a valid fallback directory
 * @returns {string} Fallback directory path
 */
function getFallbackDirectory() {
  if (process.env.HOME && fs.existsSync(process.env.HOME)) {
    return process.env.HOME;
  }
  if (fs.existsSync('/workspace/command-stream')) {
    return '/workspace/command-stream';
  }
  return '/';
}

/**
 * Restore working directory to initial or fallback
 */
function restoreWorkingDirectory() {
  try {
    let currentDir;
    try {
      currentDir = process.cwd();
    } catch (_e) {
      currentDir = null;
    }

    if (currentDir && currentDir === initialWorkingDirectory) {
      return;
    }

    if (fs.existsSync(initialWorkingDirectory)) {
      process.chdir(initialWorkingDirectory);
    } else {
      const fallback = getFallbackDirectory();
      process.chdir(fallback);
    }
  } catch (_e) {
    try {
      process.chdir(getFallbackDirectory());
    } catch (e2) {
      console.error('FATAL: Cannot set any working directory!', e2);
    }
  }
}

/**
 * Cleanup all active runners
 */
function cleanupActiveRunners() {
  for (const runner of activeProcessRunners) {
    if (!runner) {
      continue;
    }
    try {
      if (!runner.started && runner._cleanup) {
        runner._cleanup();
      } else if (runner.kill) {
        runner.kill();
      }
    } catch (_e) {
      // Ignore errors
    }
  }
}

/**
 * Complete global state reset for testing - clears all library state
 */
export function resetGlobalState() {
  restoreWorkingDirectory();
  cleanupActiveRunners();
  forceCleanupAll();
  clearShellCache();
  parentStreamsMonitored = false;
  resetShellSettings();
  virtualCommandsEnabled = true;
  resetAnsiConfig();

  if (virtualCommands.size === 0) {
    import('./commands/index.mjs').catch(() => {});
  }

  trace('GlobalState', () => 'Global state reset completed');
}
