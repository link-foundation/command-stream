// Enhanced $ shell utilities with streaming, async iteration, and EventEmitter support
// Usage patterns:
// 1. Classic await: const result = await $`command`
// 2. Async iteration: for await (const chunk of $`command`.stream()) { ... }
// 3. EventEmitter: $`command`.on('data', chunk => ...).on('end', result => ...)
// 4. Stream access: $`command`.stdout, $`command`.stderr

import cp from 'child_process';
import path from 'path';
import fs from 'fs';
import { parseShellCommand, needsRealShell } from './shell-parser.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

const VERBOSE = process.env.COMMAND_STREAM_VERBOSE === 'true' || process.env.CI === 'true';


// Trace function for verbose logging
function trace(category, messageOrFunc) {
  if (!VERBOSE) return;
  const message = typeof messageOrFunc === 'function' ? messageOrFunc() : messageOrFunc;
  const timestamp = new Date().toISOString();
  console.error(`[TRACE ${timestamp}] [${category}] ${message}`);
}

// Shell detection cache
let cachedShell = null;

// Save initial working directory for restoration
const initialWorkingDirectory = process.cwd();

/**
 * Find an available shell by checking multiple options in order
 * Returns the shell command and arguments to use
 */
function findAvailableShell() {
  if (cachedShell) {
    trace('ShellDetection', () => `Using cached shell: ${cachedShell.cmd}`);
    return cachedShell;
  }

  const shellsToTry = [
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
    { cmd: '/home/linuxbrew/.linuxbrew/bin/bash', args: ['-l', '-c'], checkPath: true },
    { cmd: '/home/linuxbrew/.linuxbrew/bin/zsh', args: ['-l', '-c'], checkPath: true },
    // Try shells in PATH as fallback (which might not work in all environments)
    // Using separate -l and -c flags for better compatibility
    { cmd: 'sh', args: ['-l', '-c'], checkPath: false },
    { cmd: 'bash', args: ['-l', '-c'], checkPath: false },
    { cmd: 'zsh', args: ['-l', '-c'], checkPath: false }
  ];

  for (const shell of shellsToTry) {
    try {
      if (shell.checkPath) {
        // Check if the absolute path exists
        if (fs.existsSync(shell.cmd)) {
          trace('ShellDetection', () => `Found shell at absolute path: ${shell.cmd}`);
          cachedShell = { cmd: shell.cmd, args: shell.args };
          return cachedShell;
        }
      } else {
        // Try to execute 'which' to check if command is in PATH
        const result = cp.spawnSync('which', [shell.cmd], { encoding: 'utf-8' });
        if (result.status === 0 && result.stdout) {
          const shellPath = result.stdout.trim();
          trace('ShellDetection', () => `Found shell in PATH: ${shell.cmd} => ${shellPath}`);
          cachedShell = { cmd: shell.cmd, args: shell.args };
          return cachedShell;
        }
      }
    } catch (e) {
      // Continue to next shell option
    }
  }

  // Final fallback - use absolute path to sh
  trace('ShellDetection', () => 'WARNING: No shell found, using /bin/sh as fallback');
  cachedShell = { cmd: '/bin/sh', args: ['-l', '-c'] };
  return cachedShell;
}



// Track parent stream state for graceful shutdown
let parentStreamsMonitored = false;
const activeProcessRunners = new Set();

// Track if SIGINT handler has been installed
let sigintHandlerInstalled = false;
let sigintHandler = null; // Store reference to remove it later

function installSignalHandlers() {
  // Check if our handler is actually installed (not just the flag)
  // This is more robust against test cleanup that manually removes listeners
  const currentListeners = process.listeners('SIGINT');
  const hasOurHandler = currentListeners.some(l => {
    const str = l.toString();
    return str.includes('activeProcessRunners') && 
           str.includes('ProcessRunner') && 
           str.includes('activeChildren');
  });
  
  if (sigintHandlerInstalled && hasOurHandler) {
    trace('SignalHandler', () => 'SIGINT handler already installed, skipping');
    return;
  }
  
  // Reset flag if handler was removed externally
  if (sigintHandlerInstalled && !hasOurHandler) {
    trace('SignalHandler', () => 'SIGINT handler flag was set but handler missing, resetting');
    sigintHandlerInstalled = false;
    sigintHandler = null;
  }
  
  trace('SignalHandler', () => `Installing SIGINT handler | ${JSON.stringify({ activeRunners: activeProcessRunners.size })}`);
  sigintHandlerInstalled = true;
  
  // Forward SIGINT to all active child processes
  // The parent process continues running - it's up to the parent to decide what to do
  sigintHandler = () => {
    // Check for other handlers immediately at the start, before doing any processing
    const currentListeners = process.listeners('SIGINT');
    const hasOtherHandlers = currentListeners.length > 1;
    
    trace('ProcessRunner', () => `SIGINT handler triggered - checking active processes`);
    
    // Count active processes (both child processes and virtual commands)  
    const activeChildren = [];
    for (const runner of activeProcessRunners) {
      if (!runner.finished) {
        // Real child process
        if (runner.child && runner.child.pid) {
          activeChildren.push(runner);
          trace('ProcessRunner', () => `Found active child: PID ${runner.child.pid}, command: ${runner.spec?.command || 'unknown'}`);
        }
        // Virtual command (no child process but still active)
        else if (!runner.child) {
          activeChildren.push(runner);
          trace('ProcessRunner', () => `Found active virtual command: ${runner.spec?.command || 'unknown'}`);
        }
      }
    }
    
    trace('ProcessRunner', () => `Parent received SIGINT | ${JSON.stringify({
      activeChildrenCount: activeChildren.length,
      hasOtherHandlers,
      platform: process.platform,
      pid: process.pid,
      ppid: process.ppid,
      activeCommands: activeChildren.map(r => ({
        hasChild: !!r.child,
        childPid: r.child?.pid,
        hasVirtualGenerator: !!r._virtualGenerator,
        finished: r.finished,
        command: r.spec?.command?.slice(0, 30)
      }))
    }, null, 2)}`);
    
    // Only handle SIGINT if we have active child processes
    // Otherwise, let other handlers or default behavior handle it
    if (activeChildren.length === 0) {
      trace('ProcessRunner', () => `No active children - skipping SIGINT forwarding, letting other handlers handle it`);
      return; // Let other handlers or default behavior handle it
    }
    
    trace('ProcessRunner', () => `Beginning SIGINT forwarding to ${activeChildren.length} active processes`);
    
    // Forward signal to all active processes (child processes and virtual commands)
    for (const runner of activeChildren) {
      try {
        if (runner.child && runner.child.pid) {
          // Real child process - send SIGINT to it
          trace('ProcessRunner', () => `Sending SIGINT to child process | ${JSON.stringify({
            pid: runner.child.pid,
            killed: runner.child.killed,
            runtime: isBun ? 'Bun' : 'Node.js',
            command: runner.spec?.command?.slice(0, 50)
          }, null, 2)}`);
          
          if (isBun) {
            runner.child.kill('SIGINT');
            trace('ProcessRunner', () => `Bun: SIGINT sent to PID ${runner.child.pid}`);
          } else {
            // Send to process group if detached, otherwise to process directly
            try {
              process.kill(-runner.child.pid, 'SIGINT');
              trace('ProcessRunner', () => `Node.js: SIGINT sent to process group -${runner.child.pid}`);
            } catch (err) {
              trace('ProcessRunner', () => `Node.js: Process group kill failed, trying direct: ${err.message}`);
              process.kill(runner.child.pid, 'SIGINT');
              trace('ProcessRunner', () => `Node.js: SIGINT sent directly to PID ${runner.child.pid}`);
            }
          }
        } else {
          // Virtual command - cancel it using the runner's kill method
          trace('ProcessRunner', () => `Cancelling virtual command | ${JSON.stringify({
            hasChild: !!runner.child,
            hasVirtualGenerator: !!runner._virtualGenerator,
            finished: runner.finished,
            cancelled: runner._cancelled,
            command: runner.spec?.command?.slice(0, 50)
          }, null, 2)}`);
          runner.kill('SIGINT');
          trace('ProcessRunner', () => `Virtual command kill() called`);
        }
      } catch (err) {
        trace('ProcessRunner', () => `Error in SIGINT handler for runner | ${JSON.stringify({
          error: err.message,
          stack: err.stack?.slice(0, 300),
          hasPid: !!(runner.child && runner.child.pid),
          pid: runner.child?.pid,
          command: runner.spec?.command?.slice(0, 50)
        }, null, 2)}`);
      }
    }
    
    // We've forwarded SIGINT to all active processes/commands
    // Use the hasOtherHandlers flag we calculated at the start (before any processing)
    trace('ProcessRunner', () => `SIGINT forwarded to ${activeChildren.length} active processes, other handlers: ${hasOtherHandlers}`);
    
    if (!hasOtherHandlers) {
      // No other handlers - we should exit like a proper shell
      trace('ProcessRunner', () => `No other SIGINT handlers, exiting with code 130`);
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
      trace('ProcessRunner', () => `Other SIGINT handlers present, letting them handle the exit completely`);
    }
  };
  
  process.on('SIGINT', sigintHandler);
}

function uninstallSignalHandlers() {
  if (!sigintHandlerInstalled || !sigintHandler) {
    trace('SignalHandler', () => 'SIGINT handler not installed or missing, skipping removal');
    return;
  }
  
  trace('SignalHandler', () => `Removing SIGINT handler | ${JSON.stringify({ activeRunners: activeProcessRunners.size })}`);
  process.removeListener('SIGINT', sigintHandler);
  sigintHandlerInstalled = false;
  sigintHandler = null;
}

// Force cleanup of all command-stream SIGINT handlers and state - for testing
function forceCleanupAll() {
  // Remove all command-stream SIGINT handlers
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter(l => {
    const str = l.toString();
    return str.includes('activeProcessRunners') || 
           str.includes('ProcessRunner') ||
           str.includes('activeChildren');
  });
  
  commandStreamListeners.forEach(listener => {
    process.removeListener('SIGINT', listener);
  });
  
  // Clear activeProcessRunners
  activeProcessRunners.clear();
  
  // Reset signal handler flags
  sigintHandlerInstalled = false;
  sigintHandler = null;
  
  trace('SignalHandler', () => `Force cleanup completed - removed ${commandStreamListeners.length} handlers`);
}

// Complete global state reset for testing - clears all library state
function resetGlobalState() {
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
        trace('GlobalState', () => `Restored working directory from ${currentDir} to ${initialWorkingDirectory}`);
      } else {
        // Initial directory is gone, use fallback
        const fallback = process.env.HOME || '/workspace/command-stream' || '/';
        if (fs.existsSync(fallback)) {
          process.chdir(fallback);
          trace('GlobalState', () => `Initial directory gone, changed to fallback: ${fallback}`);
        } else {
          // Last resort - try root
          process.chdir('/');
          trace('GlobalState', () => `Emergency fallback to root directory`);
        }
      }
    }
  } catch (e) {
    trace('GlobalState', () => `Critical error restoring working directory: ${e.message}`);
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
          trace('resetGlobalState', () => `Cleaning up unstarted ProcessRunner: ${runner.spec?.command?.slice(0, 50)}`);
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
  cachedShell = null;
  
  // Reset parent stream monitoring
  parentStreamsMonitored = false;
  
  // Reset shell settings to defaults
  globalShellSettings = {
    xtrace: false,
    errexit: false,
    pipefail: false,
    verbose: false,
    noglob: false,
    allexport: false
  };
  
  // Don't clear virtual commands - they should persist across tests
  // Just make sure they're enabled
  virtualCommandsEnabled = true;
  
  // Reset ANSI config to defaults
  globalAnsiConfig = {
    forceColor: false,
    noColor: false
  };
  
  // Make sure built-in virtual commands are registered
  if (virtualCommands.size === 0) {
    // Re-import to re-register commands (synchronously if possible)
    trace('GlobalState', () => 'Re-registering virtual commands');
    import('./commands/index.mjs').then(() => {
      trace('GlobalState', () => `Virtual commands re-registered, count: ${virtualCommands.size}`);
    }).catch((e) => {
      trace('GlobalState', () => `Error re-registering virtual commands: ${e.message}`);
    });
  }
  
  trace('GlobalState', () => 'Global state reset completed');
}

function monitorParentStreams() {
  if (parentStreamsMonitored) {
    trace('StreamMonitor', () => 'Parent streams already monitored, skipping');
    return;
  }
  trace('StreamMonitor', () => 'Setting up parent stream monitoring');
  parentStreamsMonitored = true;

  const checkParentStream = (stream, name) => {
    if (stream && typeof stream.on === 'function') {
      stream.on('close', () => {
        trace('ProcessRunner', () => `Parent ${name} closed - triggering graceful shutdown | ${JSON.stringify({ activeProcesses: activeProcessRunners.size }, null, 2)}`);
        for (const runner of activeProcessRunners) {
          runner._handleParentStreamClosure();
        }
      });
    }
  };

  checkParentStream(process.stdout, 'stdout');
  checkParentStream(process.stderr, 'stderr');
}

function safeWrite(stream, data, processRunner = null) {
  monitorParentStreams();

  if (!StreamUtils.isStreamWritable(stream)) {
    trace('ProcessRunner', () => `safeWrite skipped - stream not writable | ${JSON.stringify({
      hasStream: !!stream,
      writable: stream?.writable,
      destroyed: stream?.destroyed,
      closed: stream?.closed
    }, null, 2)}`);

    if (processRunner && (stream === process.stdout || stream === process.stderr)) {
      processRunner._handleParentStreamClosure();
    }

    return false;
  }

  try {
    return stream.write(data);
  } catch (error) {
    trace('ProcessRunner', () => `safeWrite error | ${JSON.stringify({
      error: error.message,
      code: error.code,
      writable: stream.writable,
      destroyed: stream.destroyed
    }, null, 2)}`);

    if (error.code === 'EPIPE' && processRunner &&
      (stream === process.stdout || stream === process.stderr)) {
      processRunner._handleParentStreamClosure();
    }

    return false;
  }
}

// Stream utility functions for safe operations and error handling
const StreamUtils = {
  /**
   * Check if a stream is safe to write to
   */
  isStreamWritable(stream) {
    return stream && stream.writable && !stream.destroyed && !stream.closed;
  },

  /**
   * Add standardized error handler to stdin streams
   */
  addStdinErrorHandler(stream, contextName = 'stdin', onNonEpipeError = null) {
    if (stream && typeof stream.on === 'function') {
      stream.on('error', (error) => {
        const handled = this.handleStreamError(error, `${contextName} error event`, false);
        if (!handled && onNonEpipeError) {
          onNonEpipeError(error);
        }
      });
    }
  },

  /**
   * Safely write to a stream with comprehensive error handling
   */
  safeStreamWrite(stream, data, contextName = 'stream') {
    if (!this.isStreamWritable(stream)) {
      trace('ProcessRunner', () => `${contextName} write skipped - not writable | ${JSON.stringify({
        hasStream: !!stream,
        writable: stream?.writable,
        destroyed: stream?.destroyed,
        closed: stream?.closed
      }, null, 2)}`);
      return false;
    }

    try {
      const result = stream.write(data);
      trace('ProcessRunner', () => `${contextName} write successful | ${JSON.stringify({
        dataLength: data?.length || 0
      }, null, 2)}`);
      return result;
    } catch (error) {
      if (error.code !== 'EPIPE') {
        trace('ProcessRunner', () => `${contextName} write error | ${JSON.stringify({
          error: error.message,
          code: error.code,
          isEPIPE: false
        }, null, 2)}`);
        throw error; // Re-throw non-EPIPE errors
      } else {
        trace('ProcessRunner', () => `${contextName} EPIPE error (ignored) | ${JSON.stringify({
          error: error.message,
          code: error.code,
          isEPIPE: true
        }, null, 2)}`);
      }
      return false;
    }
  },

  /**
   * Safely end a stream with error handling
   */
  safeStreamEnd(stream, contextName = 'stream') {
    if (!this.isStreamWritable(stream) || typeof stream.end !== 'function') {
      trace('ProcessRunner', () => `${contextName} end skipped - not available | ${JSON.stringify({
        hasStream: !!stream,
        hasEnd: stream && typeof stream.end === 'function',
        writable: stream?.writable
      }, null, 2)}`);
      return false;
    }

    try {
      stream.end();
      trace('ProcessRunner', () => `${contextName} ended successfully`);
      return true;
    } catch (error) {
      if (error.code !== 'EPIPE') {
        trace('ProcessRunner', () => `${contextName} end error | ${JSON.stringify({
          error: error.message,
          code: error.code
        }, null, 2)}`);
      } else {
        trace('ProcessRunner', () => `${contextName} EPIPE on end (ignored) | ${JSON.stringify({
          error: error.message,
          code: error.code
        }, null, 2)}`);
      }
      return false;
    }
  },

  /**
   * Setup comprehensive stdin handling (error handler + safe operations)
   */
  setupStdinHandling(stream, contextName = 'stdin') {
    this.addStdinErrorHandler(stream, contextName);

    return {
      write: (data) => this.safeStreamWrite(stream, data, contextName),
      end: () => this.safeStreamEnd(stream, contextName),
      isWritable: () => this.isStreamWritable(stream)
    };
  },

  /**
   * Handle stream errors with consistent EPIPE behavior
   */
  handleStreamError(error, contextName, shouldThrow = true) {
    if (error.code !== 'EPIPE') {
      trace('ProcessRunner', () => `${contextName} error | ${JSON.stringify({
        error: error.message,
        code: error.code,
        isEPIPE: false
      }, null, 2)}`);
      if (shouldThrow) throw error;
      return false;
    } else {
      trace('ProcessRunner', () => `${contextName} EPIPE error (ignored) | ${JSON.stringify({
        error: error.message,
        code: error.code,
        isEPIPE: true
      }, null, 2)}`);
      return true; // EPIPE handled gracefully
    }
  },

  /**
   * Detect if stream supports Bun-style writing
   */
  isBunStream(stream) {
    return isBun && stream && typeof stream.getWriter === 'function';
  },

  /**
   * Detect if stream supports Node.js-style writing  
   */
  isNodeStream(stream) {
    return stream && typeof stream.write === 'function';
  },

  /**
   * Write to either Bun or Node.js style stream
   */
  async writeToStream(stream, data, contextName = 'stream') {
    if (this.isBunStream(stream)) {
      try {
        const writer = stream.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      } catch (error) {
        return this.handleStreamError(error, `${contextName} Bun writer`, false);
      }
    } else if (this.isNodeStream(stream)) {
      try {
        stream.write(data);
        return true;
      } catch (error) {
        return this.handleStreamError(error, `${contextName} Node writer`, false);
      }
    }
    return false;
  }
};

let globalShellSettings = {
  errexit: false,    // set -e equivalent: exit on error
  verbose: false,    // set -v equivalent: print commands
  xtrace: false,     // set -x equivalent: trace execution
  pipefail: false,   // set -o pipefail equivalent: pipe failure detection
  nounset: false     // set -u equivalent: error on undefined variables
};

function createResult({ code, stdout = '', stderr = '', stdin = '' }) {
  return {
    code,
    stdout,
    stderr,
    stdin,
    async text() {
      return stdout;
    }
  };
}

const virtualCommands = new Map();

let virtualCommandsEnabled = true;

// EventEmitter-like implementation
class StreamEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    trace('StreamEmitter', () => `on() called | ${JSON.stringify({ 
      event,
      hasExistingListeners: this.listeners.has(event),
      listenerCount: this.listeners.get(event)?.length || 0
    })}`);
    
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);

    // No auto-start - explicit start() or await will start the process

    return this;
  }

  once(event, listener) {
    trace('StreamEmitter', () => `once() called for event: ${event}`);
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  emit(event, ...args) {
    const eventListeners = this.listeners.get(event);
    trace('StreamEmitter', () => `Emitting event | ${JSON.stringify({ 
      event, 
      hasListeners: !!eventListeners,
      listenerCount: eventListeners?.length || 0 
    })}`);
    if (eventListeners) {
      // Create a copy to avoid issues if listeners modify the array
      const listenersToCall = [...eventListeners];
      for (const listener of listenersToCall) {
        listener(...args);
      }
    }
    return this;
  }

  off(event, listener) {
    trace('StreamEmitter', () => `off() called | ${JSON.stringify({ 
      event,
      hasListeners: !!this.listeners.get(event),
      listenerCount: this.listeners.get(event)?.length || 0
    })}`);
    
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
        trace('StreamEmitter', () => `Removed listener at index ${index}`);
      }
    }
    return this;
  }
}

function quote(value) {
  if (value == null) return "''";
  if (Array.isArray(value)) return value.map(quote).join(' ');
  if (typeof value !== 'string') value = String(value);
  if (value === '') return "''";
  
  // If the value is already properly quoted and doesn't need further escaping,
  // check if we can use it as-is or with simpler quoting
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    // If it's already single-quoted and doesn't contain unescaped single quotes in the middle,
    // we can potentially use it as-is
    const inner = value.slice(1, -1);
    if (!inner.includes("'")) {
      // The inner content has no single quotes, so the original quoting is fine
      return value;
    }
  }
  
  if (value.startsWith('"') && value.endsWith('"') && value.length > 2) {
    // If it's already double-quoted, wrap it in single quotes to preserve it
    return `'${value}'`;
  }
  
  // Check if the string needs quoting at all
  // Safe characters: alphanumeric, dash, underscore, dot, slash, colon, equals, comma, plus
  // This regex matches strings that DON'T need quoting
  const safePattern = /^[a-zA-Z0-9_\-./=,+@:]+$/;
  
  if (safePattern.test(value)) {
    // The string is safe and doesn't need quoting
    return value;
  }
  
  // Default behavior: wrap in single quotes and escape any internal single quotes
  // This handles spaces, special shell characters, etc.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(strings, values) {
  trace('Utils', () => `buildShellCommand ENTER | ${JSON.stringify({
    stringsLength: strings.length,
    valuesLength: values.length
  }, null, 2)}`);

  // Special case: if we have a single value with empty surrounding strings,
  // and the value looks like a complete shell command, treat it as raw
  if (values.length === 1 && strings.length === 2 && 
      strings[0] === '' && strings[1] === '' &&
      typeof values[0] === 'string') {
    const commandStr = values[0];
    // Check if this looks like a complete shell command (contains spaces and shell-safe characters)
    const commandPattern = /^[a-zA-Z0-9_\-./=,+@:\s"'`$(){}<>|&;*?[\]~\\]+$/;
    if (commandPattern.test(commandStr) && commandStr.trim().length > 0) {
      trace('Utils', () => `BRANCH: buildShellCommand => COMPLETE_COMMAND | ${JSON.stringify({ command: commandStr }, null, 2)}`);
      return commandStr;
    }
  }

  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'raw')) {
        trace('Utils', () => `BRANCH: buildShellCommand => RAW_VALUE | ${JSON.stringify({ value: String(v.raw) }, null, 2)}`);
        out += String(v.raw);
      } else {
        const quoted = quote(v);
        trace('Utils', () => `BRANCH: buildShellCommand => QUOTED_VALUE | ${JSON.stringify({ original: v, quoted }, null, 2)}`);
        out += quoted;
      }
    }
  }

  trace('Utils', () => `buildShellCommand EXIT | ${JSON.stringify({ command: out }, null, 2)}`);
  return out;
}

function asBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) {
    trace('Utils', () => `asBuffer: Already a buffer, length: ${chunk.length}`);
    return chunk;
  }
  if (typeof chunk === 'string') {
    trace('Utils', () => `asBuffer: Converting string to buffer, length: ${chunk.length}`);
    return Buffer.from(chunk);
  }
  trace('Utils', () => 'asBuffer: Converting unknown type to buffer');
  return Buffer.from(chunk);
}

async function pumpReadable(readable, onChunk) {
  if (!readable) {
    trace('Utils', () => 'pumpReadable: No readable stream provided');
    return;
  }
  trace('Utils', () => 'pumpReadable: Starting to pump readable stream');
  for await (const chunk of readable) {
    await onChunk(asBuffer(chunk));
  }
  trace('Utils', () => 'pumpReadable: Finished pumping readable stream');
}

// Enhanced process runner with streaming capabilities
class ProcessRunner extends StreamEmitter {
  constructor(spec, options = {}) {
    super();

    trace('ProcessRunner', () => `constructor ENTER | ${JSON.stringify({
      spec: typeof spec === 'object' ? { ...spec, command: spec.command?.slice(0, 100) } : spec,
      options
    }, null, 2)}`);

    this.spec = spec;
    this.options = {
      mirror: true,
      capture: true,
      stdin: 'inherit',
      cwd: undefined,
      env: undefined,
      interactive: false, // Explicitly request TTY forwarding for interactive commands
      shellOperators: true, // Enable shell operator parsing by default
      ...options
    };

    this.outChunks = this.options.capture ? [] : null;
    this.errChunks = this.options.capture ? [] : null;
    this.inChunks = this.options.capture && this.options.stdin === 'inherit' ? [] :
      this.options.capture && (typeof this.options.stdin === 'string' || Buffer.isBuffer(this.options.stdin)) ?
        [Buffer.from(this.options.stdin)] : [];

    this.result = null;
    this.child = null;
    this.started = false;
    this.finished = false;

    // Promise for awaiting final result
    this.promise = null;

    this._mode = null; // 'async' or 'sync'

    this._cancelled = false;
    this._cancellationSignal = null; // Track which signal caused cancellation
    this._virtualGenerator = null;
    this._abortController = new AbortController();

    activeProcessRunners.add(this);
    
    // Ensure parent stream monitoring is set up for all ProcessRunners
    monitorParentStreams();
    
    trace('ProcessRunner', () => `Added to activeProcessRunners | ${JSON.stringify({ 
      command: this.spec?.command || 'unknown',
      totalActive: activeProcessRunners.size 
    }, null, 2)}`);
    installSignalHandlers();

    this.finished = false;
  }

  // Stream property getters for child process streams (null for virtual commands)
  get stdout() {
    trace('ProcessRunner', () => `stdout getter accessed | ${JSON.stringify({
      hasChild: !!this.child,
      hasStdout: !!(this.child && this.child.stdout)
    }, null, 2)}`);
    return this.child ? this.child.stdout : null;
  }

  get stderr() {
    trace('ProcessRunner', () => `stderr getter accessed | ${JSON.stringify({
      hasChild: !!this.child,
      hasStderr: !!(this.child && this.child.stderr)
    }, null, 2)}`);
    return this.child ? this.child.stderr : null;
  }

  get stdin() {
    trace('ProcessRunner', () => `stdin getter accessed | ${JSON.stringify({
      hasChild: !!this.child,
      hasStdin: !!(this.child && this.child.stdin)
    }, null, 2)}`);
    return this.child ? this.child.stdin : null;
  }

  // Issue #33: New streaming interfaces
  _autoStartIfNeeded(reason) {
    if (!this.started && !this.finished) {
      trace('ProcessRunner', () => `Auto-starting process due to ${reason}`);
      this.start({ mode: 'async', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    }
  }

  get streams() {
    const self = this;
    return {
      get stdin() {
        trace('ProcessRunner.streams', () => `stdin access | ${JSON.stringify({
          hasChild: !!self.child,
          hasStdin: !!(self.child && self.child.stdin),
          started: self.started,
          finished: self.finished,
          hasPromise: !!self.promise,
          command: self.spec?.command?.slice(0, 50)
        }, null, 2)}`);
        
        self._autoStartIfNeeded('streams.stdin access');
        
        // Streams are available immediately after spawn, or null if not piped
        // Return the stream directly if available, otherwise ensure process starts
        if (self.child && self.child.stdin) {
          trace('ProcessRunner.streams', () => 'stdin: returning existing stream');
          return self.child.stdin;
        }
        if (self.finished) {
          trace('ProcessRunner.streams', () => 'stdin: process finished, returning null');
          return null;
        }
        
        // For virtual commands, there's no child process
        // Exception: virtual commands with stdin: "pipe" will fallback to real commands
        const isVirtualCommand = self._virtualGenerator || (self.spec && self.spec.command && virtualCommands.has(self.spec.command.split(' ')[0]));
        const willFallbackToReal = isVirtualCommand && self.options.stdin === 'pipe';
        
        if (isVirtualCommand && !willFallbackToReal) {
          trace('ProcessRunner.streams', () => 'stdin: virtual command, returning null');
          return null;
        }
        
        // If not started, start it and wait for child to be created (not for completion!)
        if (!self.started) {
          trace('ProcessRunner.streams', () => 'stdin: not started, starting and waiting for child');
          // Start the process
          self._startAsync();
          // Wait for child to be created using async iteration
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stdin) {
                resolve(self.child.stdin);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                // Use setImmediate to check again in next event loop iteration
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        // Process is starting - wait for child to appear
        if (self.promise && !self.child) {
          trace('ProcessRunner.streams', () => 'stdin: process starting, waiting for child');
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stdin) {
                resolve(self.child.stdin);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        trace('ProcessRunner.streams', () => 'stdin: returning null (no conditions met)');
        return null;
      },
      get stdout() {
        trace('ProcessRunner.streams', () => `stdout access | ${JSON.stringify({
          hasChild: !!self.child,
          hasStdout: !!(self.child && self.child.stdout),
          started: self.started,
          finished: self.finished,
          hasPromise: !!self.promise,
          command: self.spec?.command?.slice(0, 50)
        }, null, 2)}`);
        
        self._autoStartIfNeeded('streams.stdout access');
        
        if (self.child && self.child.stdout) {
          trace('ProcessRunner.streams', () => 'stdout: returning existing stream');
          return self.child.stdout;
        }
        if (self.finished) {
          trace('ProcessRunner.streams', () => 'stdout: process finished, returning null');
          return null;
        }
        
        // For virtual commands, there's no child process
        if (self._virtualGenerator || (self.spec && self.spec.command && virtualCommands.has(self.spec.command.split(' ')[0]))) {
          trace('ProcessRunner.streams', () => 'stdout: virtual command, returning null');
          return null;
        }
        
        if (!self.started) {
          trace('ProcessRunner.streams', () => 'stdout: not started, starting and waiting for child');
          self._startAsync();
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stdout) {
                resolve(self.child.stdout);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        if (self.promise && !self.child) {
          trace('ProcessRunner.streams', () => 'stdout: process starting, waiting for child');
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stdout) {
                resolve(self.child.stdout);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        trace('ProcessRunner.streams', () => 'stdout: returning null (no conditions met)');
        return null;
      },
      get stderr() {
        trace('ProcessRunner.streams', () => `stderr access | ${JSON.stringify({
          hasChild: !!self.child,
          hasStderr: !!(self.child && self.child.stderr),
          started: self.started,
          finished: self.finished,
          hasPromise: !!self.promise,
          command: self.spec?.command?.slice(0, 50)
        }, null, 2)}`);
        
        self._autoStartIfNeeded('streams.stderr access');
        
        if (self.child && self.child.stderr) {
          trace('ProcessRunner.streams', () => 'stderr: returning existing stream');
          return self.child.stderr;
        }
        if (self.finished) {
          trace('ProcessRunner.streams', () => 'stderr: process finished, returning null');
          return null;
        }
        
        // For virtual commands, there's no child process
        if (self._virtualGenerator || (self.spec && self.spec.command && virtualCommands.has(self.spec.command.split(' ')[0]))) {
          trace('ProcessRunner.streams', () => 'stderr: virtual command, returning null');
          return null;
        }
        
        if (!self.started) {
          trace('ProcessRunner.streams', () => 'stderr: not started, starting and waiting for child');
          self._startAsync();
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stderr) {
                resolve(self.child.stderr);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        if (self.promise && !self.child) {
          trace('ProcessRunner.streams', () => 'stderr: process starting, waiting for child');
          return new Promise((resolve) => {
            const checkForChild = () => {
              if (self.child && self.child.stderr) {
                resolve(self.child.stderr);
              } else if (self.finished || self._virtualGenerator) {
                resolve(null);
              } else {
                setImmediate(checkForChild);
              }
            };
            setImmediate(checkForChild);
          });
        }
        
        trace('ProcessRunner.streams', () => 'stderr: returning null (no conditions met)');
        return null;
      }
    };
  }

  get buffers() {
    const self = this;
    return {
      get stdin() {
        self._autoStartIfNeeded('buffers.stdin access');
        if (self.finished && self.result) {
          return Buffer.from(self.result.stdin || '', 'utf8');
        }
        // Return promise if not finished
        return self.then ? self.then(result => Buffer.from(result.stdin || '', 'utf8')) : Promise.resolve(Buffer.alloc(0));
      },
      get stdout() {
        self._autoStartIfNeeded('buffers.stdout access');
        if (self.finished && self.result) {
          return Buffer.from(self.result.stdout || '', 'utf8');
        }
        // Return promise if not finished
        return self.then ? self.then(result => Buffer.from(result.stdout || '', 'utf8')) : Promise.resolve(Buffer.alloc(0));
      },
      get stderr() {
        self._autoStartIfNeeded('buffers.stderr access');
        if (self.finished && self.result) {
          return Buffer.from(self.result.stderr || '', 'utf8');
        }
        // Return promise if not finished
        return self.then ? self.then(result => Buffer.from(result.stderr || '', 'utf8')) : Promise.resolve(Buffer.alloc(0));
      }
    };
  }

  get strings() {
    const self = this;
    return {
      get stdin() {
        self._autoStartIfNeeded('strings.stdin access');
        if (self.finished && self.result) {
          return self.result.stdin || '';
        }
        // Return promise if not finished
        return self.then ? self.then(result => result.stdin || '') : Promise.resolve('');
      },
      get stdout() {
        self._autoStartIfNeeded('strings.stdout access');
        if (self.finished && self.result) {
          return self.result.stdout || '';
        }
        // Return promise if not finished
        return self.then ? self.then(result => result.stdout || '') : Promise.resolve('');
      },
      get stderr() {
        self._autoStartIfNeeded('strings.stderr access');
        if (self.finished && self.result) {
          return self.result.stderr || '';
        }
        // Return promise if not finished  
        return self.then ? self.then(result => result.stderr || '') : Promise.resolve('');
      }
    };
  }


  // Centralized method to properly finish a process with correct event emission order
  finish(result) {
    trace('ProcessRunner', () => `finish() called | ${JSON.stringify({
      alreadyFinished: this.finished,
      resultCode: result?.code,
      hasStdout: !!result?.stdout,
      hasStderr: !!result?.stderr,
      command: this.spec?.command?.slice(0, 50)
    }, null, 2)}`);
    
    // Make finish() idempotent - safe to call multiple times
    if (this.finished) {
      trace('ProcessRunner', () => `Already finished, returning existing result`);
      return this.result || result;
    }

    // Store result
    this.result = result;
    trace('ProcessRunner', () => `Result stored, about to emit events`);

    // Emit completion events BEFORE setting finished to prevent _cleanup() from clearing listeners
    this.emit('end', result);
    trace('ProcessRunner', () => `'end' event emitted`);
    this.emit('exit', result.code);
    trace('ProcessRunner', () => `'exit' event emitted with code ${result.code}`);

    // Set finished after events are emitted
    this.finished = true;
    trace('ProcessRunner', () => `Marked as finished, calling cleanup`);

    // Trigger cleanup now that process is finished
    this._cleanup();
    trace('ProcessRunner', () => `Cleanup completed`);

    return result;
  }

  _emitProcessedData(type, buf) {
    // Don't emit data if we've been cancelled
    if (this._cancelled) {
      trace('ProcessRunner', () => 'Skipping data emission - process cancelled');
      return;
    }
    const processedBuf = processOutput(buf, this.options.ansi);
    this.emit(type, processedBuf);
    this.emit('data', { type, data: processedBuf });
  }

  async _forwardTTYStdin() {
    trace('ProcessRunner', () => `_forwardTTYStdin ENTER | ${JSON.stringify({
      isTTY: process.stdin.isTTY,
      hasChildStdin: !!this.child?.stdin
    }, null, 2)}`);
    
    if (!process.stdin.isTTY || !this.child.stdin) {
      trace('ProcessRunner', () => 'TTY forwarding skipped - no TTY or no child stdin');
      return;
    }

    try {
      // Set raw mode to forward keystrokes immediately
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Forward stdin data to child process
      const onData = (chunk) => {
        // Check for CTRL+C (ASCII code 3)
        if (chunk[0] === 3) {
          trace('ProcessRunner', () => 'CTRL+C detected, sending SIGINT to child process');
          // Send SIGINT to the child process
          if (this.child && this.child.pid) {
            try {
              if (isBun) {
                this.child.kill('SIGINT');
              } else {
                // In Node.js, send SIGINT to the process group if detached
                // or to the process directly if not
                if (this.child.pid > 0) {
                  try {
                    // Try process group first if detached
                    process.kill(-this.child.pid, 'SIGINT');
                  } catch (err) {
                    // Fall back to direct process
                    process.kill(this.child.pid, 'SIGINT');
                  }
                }
              }
            } catch (err) {
              trace('ProcessRunner', () => `Error sending SIGINT: ${err.message}`);
            }
          }
          // Don't forward CTRL+C to stdin, just handle the signal
          return;
        }
        
        // Forward other input to child stdin
        if (this.child.stdin) {
          if (isBun && this.child.stdin.write) {
            this.child.stdin.write(chunk);
          } else if (this.child.stdin.write) {
            this.child.stdin.write(chunk);
          }
        }
      };

      const cleanup = () => {
        trace('ProcessRunner', () => 'TTY stdin cleanup - restoring terminal mode');
        process.stdin.removeListener('data', onData);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      };

      process.stdin.on('data', onData);

      // Clean up when child process exits
      const childExit = isBun ? this.child.exited : new Promise((resolve) => {
        this.child.once('close', resolve);
        this.child.once('exit', resolve);
      });

      childExit.then(cleanup).catch(cleanup);

      return childExit;
    } catch (error) {
      trace('ProcessRunner', () => `TTY stdin forwarding error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    }
  }


  _handleParentStreamClosure() {
    if (this.finished || this._cancelled) {
      trace('ProcessRunner', () => `Parent stream closure ignored | ${JSON.stringify({
        finished: this.finished,
        cancelled: this._cancelled
      })}`);
      return;
    }

    trace('ProcessRunner', () => `Handling parent stream closure | ${JSON.stringify({
      started: this.started,
      hasChild: !!this.child,
      command: this.spec.command?.slice(0, 50) || this.spec.file
    }, null, 2)}`);

    this._cancelled = true;

    // Cancel abort controller for virtual commands
    if (this._abortController) {
      this._abortController.abort();
    }

    // Gracefully close child process if it exists
    if (this.child) {
      try {
        // Close stdin first to signal completion
        if (this.child.stdin && typeof this.child.stdin.end === 'function') {
          this.child.stdin.end();
        } else if (isBun && this.child.stdin && typeof this.child.stdin.getWriter === 'function') {
          const writer = this.child.stdin.getWriter();
          writer.close().catch(() => { }); // Ignore close errors
        }

        // Use setImmediate for deferred termination instead of setTimeout
        setImmediate(() => {
          if (this.child && !this.finished) {
            trace('ProcessRunner', () => 'Terminating child process after parent stream closure');
            if (typeof this.child.kill === 'function') {
              this.child.kill('SIGTERM');
            }
          }
        });

      } catch (error) {
        trace('ProcessRunner', () => `Error during graceful shutdown | ${JSON.stringify({ error: error.message }, null, 2)}`);
      }
    }

    this._cleanup();
  }

  _cleanup() {
    trace('ProcessRunner', () => `_cleanup() called | ${JSON.stringify({
      wasActiveBeforeCleanup: activeProcessRunners.has(this),
      totalActiveBefore: activeProcessRunners.size,
      finished: this.finished,
      hasChild: !!this.child,
      command: this.spec?.command?.slice(0, 50)
    }, null, 2)}`);
    
    const wasActive = activeProcessRunners.has(this);
    activeProcessRunners.delete(this);
    
    if (wasActive) {
      trace('ProcessRunner', () => `Removed from activeProcessRunners | ${JSON.stringify({ 
        command: this.spec?.command || 'unknown',
        totalActiveAfter: activeProcessRunners.size,
        remainingCommands: Array.from(activeProcessRunners).map(r => r.spec?.command?.slice(0, 30))
      }, null, 2)}`);
    } else {
      trace('ProcessRunner', () => `Was not in activeProcessRunners (already cleaned up)`);
    }
    
    // If this is a pipeline runner, also clean up the source and destination
    if (this.spec?.mode === 'pipeline') {
      trace('ProcessRunner', () => 'Cleaning up pipeline components');
      if (this.spec.source && typeof this.spec.source._cleanup === 'function') {
        this.spec.source._cleanup();
      }
      if (this.spec.destination && typeof this.spec.destination._cleanup === 'function') {
        this.spec.destination._cleanup();
      }
    }
    
    // If no more active ProcessRunners, remove the SIGINT handler
    if (activeProcessRunners.size === 0) {
      uninstallSignalHandlers();
    }
    
    // Clean up event listeners from StreamEmitter
    if (this.listeners) {
      this.listeners.clear();
    }
    
    // Clean up abort controller
    if (this._abortController) {
      trace('ProcessRunner', () => `Cleaning up abort controller during cleanup | ${JSON.stringify({
        wasAborted: this._abortController?.signal?.aborted
      }, null, 2)}`);
      try {
        this._abortController.abort();
        trace('ProcessRunner', () => `Abort controller aborted successfully during cleanup`);
      } catch (e) {
        trace('ProcessRunner', () => `Error aborting controller during cleanup: ${e.message}`);
      }
      this._abortController = null;
      trace('ProcessRunner', () => `Abort controller reference cleared during cleanup`);
    } else {
      trace('ProcessRunner', () => `No abort controller to clean up during cleanup`);
    }
    
    // Clean up child process reference
    if (this.child) {
      trace('ProcessRunner', () => `Cleaning up child process reference | ${JSON.stringify({
        hasChild: true,
        childPid: this.child.pid,
        childKilled: this.child.killed
      }, null, 2)}`);
      try {
        this.child.removeAllListeners?.();
        trace('ProcessRunner', () => `Child process listeners removed successfully`);
      } catch (e) {
        trace('ProcessRunner', () => `Error removing child process listeners: ${e.message}`);
      }
      this.child = null;
      trace('ProcessRunner', () => `Child process reference cleared`);
    } else {
      trace('ProcessRunner', () => `No child process reference to clean up`);
    }
    
    // Clean up virtual generator
    if (this._virtualGenerator) {
      trace('ProcessRunner', () => `Cleaning up virtual generator | ${JSON.stringify({
        hasReturn: !!this._virtualGenerator.return
      }, null, 2)}`);
      try {
        if (this._virtualGenerator.return) {
          this._virtualGenerator.return();
          trace('ProcessRunner', () => `Virtual generator return() called successfully`);
        }
      } catch (e) {
        trace('ProcessRunner', () => `Error calling virtual generator return(): ${e.message}`);
      }
      this._virtualGenerator = null;
      trace('ProcessRunner', () => `Virtual generator reference cleared`);
    } else {
      trace('ProcessRunner', () => `No virtual generator to clean up`);
    }
    
    trace('ProcessRunner', () => `_cleanup() completed | ${JSON.stringify({
      totalActiveAfter: activeProcessRunners.size,
      sigintListenerCount: process.listeners('SIGINT').length
    }, null, 2)}`);
  }

  // Unified start method that can work in both async and sync modes
  start(options = {}) {
    const mode = options.mode || 'async';

    trace('ProcessRunner', () => `start ENTER | ${JSON.stringify({ 
      mode, 
      options, 
      started: this.started,
      hasPromise: !!this.promise,
      hasChild: !!this.child,
      command: this.spec?.command?.slice(0, 50)
    }, null, 2)}`);

    // Merge new options with existing options before starting
    if (Object.keys(options).length > 0 && !this.started) {
      trace('ProcessRunner', () => `BRANCH: options => MERGE | ${JSON.stringify({ 
        oldOptions: this.options, 
        newOptions: options 
      }, null, 2)}`);

      // Create a new options object merging the current ones with the new ones
      this.options = { ...this.options, ...options };
      
      // Handle external abort signal
      if (this.options.signal && typeof this.options.signal.addEventListener === 'function') {
        trace('ProcessRunner', () => `Setting up external abort signal listener | ${JSON.stringify({
          hasSignal: !!this.options.signal,
          signalAborted: this.options.signal.aborted,
          hasInternalController: !!this._abortController,
          internalAborted: this._abortController?.signal.aborted
        }, null, 2)}`);
        
        this.options.signal.addEventListener('abort', () => {
          trace('ProcessRunner', () => `External abort signal triggered | ${JSON.stringify({
            externalSignalAborted: this.options.signal.aborted,
            hasInternalController: !!this._abortController,
            internalAborted: this._abortController?.signal.aborted,
            command: this.spec?.command?.slice(0, 50)
          }, null, 2)}`);
          
          // Kill the process when abort signal is triggered
          trace('ProcessRunner', () => `External abort signal received - killing process | ${JSON.stringify({
            hasChild: !!this.child,
            childPid: this.child?.pid,
            finished: this.finished,
            command: this.spec?.command?.slice(0, 50)
          }, null, 2)}`);
          this.kill('SIGTERM');
          trace('ProcessRunner', () => 'Process kill initiated due to external abort signal');
          
          if (this._abortController && !this._abortController.signal.aborted) {
            trace('ProcessRunner', () => 'Aborting internal controller due to external signal');
            this._abortController.abort();
            trace('ProcessRunner', () => `Internal controller aborted | ${JSON.stringify({
              internalAborted: this._abortController?.signal?.aborted
            }, null, 2)}`);
          } else {
            trace('ProcessRunner', () => `Cannot abort internal controller | ${JSON.stringify({
              hasInternalController: !!this._abortController,
              internalAlreadyAborted: this._abortController?.signal?.aborted
            }, null, 2)}`);
          }
        });
        
        // If the external signal is already aborted, abort immediately
        if (this.options.signal.aborted) {
          trace('ProcessRunner', () => `External signal already aborted, killing process and aborting internal controller | ${JSON.stringify({
            hasInternalController: !!this._abortController,
            internalAborted: this._abortController?.signal.aborted
          }, null, 2)}`);
          
          // Kill the process immediately since signal is already aborted
          trace('ProcessRunner', () => `Signal already aborted - killing process immediately | ${JSON.stringify({
            hasChild: !!this.child,
            childPid: this.child?.pid,
            finished: this.finished,
            command: this.spec?.command?.slice(0, 50)
          }, null, 2)}`);
          this.kill('SIGTERM');
          trace('ProcessRunner', () => 'Process kill initiated due to pre-aborted signal');
          
          if (this._abortController && !this._abortController.signal.aborted) {
            this._abortController.abort();
            trace('ProcessRunner', () => `Internal controller aborted immediately | ${JSON.stringify({
              internalAborted: this._abortController?.signal?.aborted
            }, null, 2)}`);
          }
        }
      } else {
        trace('ProcessRunner', () => `No external signal to handle | ${JSON.stringify({
          hasSignal: !!this.options.signal,
          signalType: typeof this.options.signal,
          hasAddEventListener: !!(this.options.signal && typeof this.options.signal.addEventListener === 'function')
        }, null, 2)}`);
      }
      
      // Reinitialize chunks based on updated capture option
      if ('capture' in options) {
        trace('ProcessRunner', () => `BRANCH: capture => REINIT_CHUNKS | ${JSON.stringify({ 
          capture: this.options.capture 
        }, null, 2)}`);
        
        this.outChunks = this.options.capture ? [] : null;
        this.errChunks = this.options.capture ? [] : null;
        this.inChunks = this.options.capture && this.options.stdin === 'inherit' ? [] :
          this.options.capture && (typeof this.options.stdin === 'string' || Buffer.isBuffer(this.options.stdin)) ?
            [Buffer.from(this.options.stdin)] : [];
      }
      
      trace('ProcessRunner', () => `OPTIONS_MERGED | ${JSON.stringify({ 
        finalOptions: this.options 
      }, null, 2)}`);
    } else if (Object.keys(options).length > 0 && this.started) {
      trace('ProcessRunner', () => `BRANCH: options => IGNORED_ALREADY_STARTED | ${JSON.stringify({}, null, 2)}`);
    }

    if (mode === 'sync') {
      trace('ProcessRunner', () => `BRANCH: mode => sync | ${JSON.stringify({}, null, 2)}`);
      return this._startSync();
    } else {
      trace('ProcessRunner', () => `BRANCH: mode => async | ${JSON.stringify({}, null, 2)}`);
      return this._startAsync();
    }
  }

  // Shortcut for sync mode
  sync() {
    return this.start({ mode: 'sync' });
  }

  // Shortcut for async mode
  async() {
    return this.start({ mode: 'async' });
  }

  // Alias for start() method
  run(options = {}) {
    trace('ProcessRunner', () => `run ENTER | ${JSON.stringify({ options }, null, 2)}`);
    return this.start(options);
  }

  async _startAsync() {
    if (this.started) return this.promise;
    if (this.promise) return this.promise;

    this.promise = this._doStartAsync();
    return this.promise;
  }

  async _doStartAsync() {
    trace('ProcessRunner', () => `_doStartAsync ENTER | ${JSON.stringify({
      mode: this.spec.mode,
      command: this.spec.command?.slice(0, 100)
    }, null, 2)}`);

    this.started = true;
    this._mode = 'async';

    // Ensure cleanup happens even if execution fails
    try {

    const { cwd, env, stdin } = this.options;

    if (this.spec.mode === 'pipeline') {
      trace('ProcessRunner', () => `BRANCH: spec.mode => pipeline | ${JSON.stringify({
        hasSource: !!this.spec.source,
        hasDestination: !!this.spec.destination
      }, null, 2)}`);
      return await this._runProgrammaticPipeline(this.spec.source, this.spec.destination);
    }

    if (this.spec.mode === 'shell') {
      trace('ProcessRunner', () => `BRANCH: spec.mode => shell | ${JSON.stringify({}, null, 2)}`);

      // Check if shell operator parsing is enabled and command contains operators
      const hasShellOperators = this.spec.command.includes('&&') || 
                                this.spec.command.includes('||') || 
                                this.spec.command.includes('(') ||
                                this.spec.command.includes(';') ||
                                (this.spec.command.includes('cd ') && this.spec.command.includes('&&'));
      
      // Intelligent detection: disable shell operators for streaming patterns
      const isStreamingPattern = this.spec.command.includes('sleep') && this.spec.command.includes(';') && 
                                 (this.spec.command.includes('echo') || this.spec.command.includes('printf'));
      
      // Also check if we're in streaming mode (via .stream() method)
      const shouldUseShellOperators = this.options.shellOperators && hasShellOperators && !isStreamingPattern && !this._isStreaming;
      
      trace('ProcessRunner', () => `Shell operator detection | ${JSON.stringify({
        hasShellOperators,
        shellOperatorsEnabled: this.options.shellOperators,
        isStreamingPattern,
        isStreaming: this._isStreaming,
        shouldUseShellOperators,
        command: this.spec.command.slice(0, 100)
      }, null, 2)}`);
      
      // Only use enhanced parser when appropriate
      if (!this.options._bypassVirtual && shouldUseShellOperators && !needsRealShell(this.spec.command)) {
        const enhancedParsed = parseShellCommand(this.spec.command);
        if (enhancedParsed && enhancedParsed.type !== 'simple') {
          trace('ProcessRunner', () => `Using enhanced parser for shell operators | ${JSON.stringify({
            type: enhancedParsed.type,
            command: this.spec.command.slice(0, 50)
          }, null, 2)}`);
          
          if (enhancedParsed.type === 'sequence') {
            return await this._runSequence(enhancedParsed);
          } else if (enhancedParsed.type === 'subshell') {
            return await this._runSubshell(enhancedParsed);
          } else if (enhancedParsed.type === 'pipeline') {
            return await this._runPipeline(enhancedParsed.commands);
          }
        }
      }

      // Fallback to original simple parser
      const parsed = this._parseCommand(this.spec.command);
      trace('ProcessRunner', () => `Parsed command | ${JSON.stringify({
        type: parsed?.type,
        cmd: parsed?.cmd,
        argsCount: parsed?.args?.length
      }, null, 2)}`);

      if (parsed) {
        if (parsed.type === 'pipeline') {
          trace('ProcessRunner', () => `BRANCH: parsed.type => pipeline | ${JSON.stringify({
            commandCount: parsed.commands?.length
          }, null, 2)}`);
          return await this._runPipeline(parsed.commands);
        } else if (parsed.type === 'simple' && virtualCommandsEnabled && virtualCommands.has(parsed.cmd) && !this.options._bypassVirtual) {
          // For built-in virtual commands that have real counterparts (like sleep),
          // skip the virtual version when custom stdin is provided to ensure proper process handling
          const hasCustomStdin = this.options.stdin && 
                                 this.options.stdin !== 'inherit' && 
                                 this.options.stdin !== 'ignore';
          
          // Only bypass for commands that truly need real process behavior with custom stdin
          // Most commands like 'echo' work fine with virtual implementations even with stdin
          const commandsThatNeedRealStdin = ['sleep', 'cat']; // Only these really need real processes for stdin
          const shouldBypassVirtual = hasCustomStdin && commandsThatNeedRealStdin.includes(parsed.cmd);
          
          if (shouldBypassVirtual) {
            trace('ProcessRunner', () => `Bypassing built-in virtual command due to custom stdin | ${JSON.stringify({
              cmd: parsed.cmd,
              stdin: typeof this.options.stdin
            }, null, 2)}`);
            // Fall through to run as real command
          } else {
            trace('ProcessRunner', () => `BRANCH: virtualCommand => ${parsed.cmd} | ${JSON.stringify({
              isVirtual: true,
              args: parsed.args
            }, null, 2)}`);
            trace('ProcessRunner', () => `Executing virtual command | ${JSON.stringify({
              cmd: parsed.cmd,
              argsLength: parsed.args.length,
              command: this.spec.command
            }, null, 2)}`);
            return await this._runVirtual(parsed.cmd, parsed.args, this.spec.command);
          }
        }
      }
    }

    const shell = findAvailableShell();
    const argv = this.spec.mode === 'shell' ? [shell.cmd, ...shell.args, this.spec.command] : [this.spec.file, ...this.spec.args];
    trace('ProcessRunner', () => `Constructed argv | ${JSON.stringify({
      mode: this.spec.mode,
      argv: argv,
      originalCommand: this.spec.command
    }, null, 2)}`);

    if (globalShellSettings.xtrace) {
      const traceCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
      trace('ProcessRunner', () => `xtrace output displayed: + ${traceCmd}`);
    }

    if (globalShellSettings.verbose) {
      const verboseCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
      trace('ProcessRunner', () => `verbose output displayed: ${verboseCmd}`);
    }

    // Detect if this is an interactive command that needs direct TTY access
    // Only activate for interactive commands when we have a real TTY and interactive mode is explicitly requested
    const isInteractive = stdin === 'inherit' && 
      process.stdin.isTTY === true && 
      process.stdout.isTTY === true && 
      process.stderr.isTTY === true &&
      this.options.interactive === true;
    
    trace('ProcessRunner', () => `Interactive command detection | ${JSON.stringify({
      isInteractive,
      stdinInherit: stdin === 'inherit',
      stdinTTY: process.stdin.isTTY,
      stdoutTTY: process.stdout.isTTY,
      stderrTTY: process.stderr.isTTY,
      interactiveOption: this.options.interactive
    }, null, 2)}`);

    const spawnBun = (argv) => {
      trace('ProcessRunner', () => `spawnBun: Creating process | ${JSON.stringify({
        command: argv[0],
        args: argv.slice(1),
        isInteractive,
        cwd,
        platform: process.platform
      }, null, 2)}`);
      
      if (isInteractive) {
        // For interactive commands, use inherit to provide direct TTY access
        trace('ProcessRunner', () => `spawnBun: Using interactive mode with inherited stdio`);
        const child = Bun.spawn(argv, { cwd, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
        trace('ProcessRunner', () => `spawnBun: Interactive process created | ${JSON.stringify({
          pid: child.pid,
          killed: child.killed
        }, null, 2)}`);
        return child;
      }
      // For non-interactive commands, spawn with detached to create process group (for proper signal handling)
      // This allows us to send signals to the entire process group, killing shell and all its children
      trace('ProcessRunner', () => `spawnBun: Using non-interactive mode with pipes and detached=${process.platform !== 'win32'}`);
      trace('ProcessRunner', () => `spawnBun: About to spawn | ${JSON.stringify({
        argv,
        cwd,
        shellCmd: argv[0],
        shellArgs: argv.slice(1, -1),
        command: argv[argv.length - 1]?.slice(0, 50)
      }, null, 2)}`);
      
      const child = Bun.spawn(argv, { 
        cwd, 
        env, 
        stdin: 'pipe', 
        stdout: 'pipe', 
        stderr: 'pipe',
        detached: process.platform !== 'win32' // Create process group on Unix-like systems
      });
      trace('ProcessRunner', () => `spawnBun: Non-interactive process created | ${JSON.stringify({
        pid: child.pid,
        killed: child.killed,
        hasStdout: !!child.stdout,
        hasStderr: !!child.stderr,
        hasStdin: !!child.stdin
      }, null, 2)}`);
      return child;
    };
    const spawnNode = async (argv) => {
      trace('ProcessRunner', () => `spawnNode: Creating process | ${JSON.stringify({
        command: argv[0],
        args: argv.slice(1),
        isInteractive,
        cwd,
        platform: process.platform
      })}`);
      
      if (isInteractive) {
        // For interactive commands, use inherit to provide direct TTY access
        return cp.spawn(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
      }
      // For non-interactive commands, spawn with detached to create process group (for proper signal handling)
      // This allows us to send signals to the entire process group
      const child = cp.spawn(argv[0], argv.slice(1), { 
        cwd, 
        env, 
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32' // Create process group on Unix-like systems
      });
      
      trace('ProcessRunner', () => `spawnNode: Process created | ${JSON.stringify({
        pid: child.pid,
        killed: child.killed,
        hasStdout: !!child.stdout,
        hasStderr: !!child.stderr,
        hasStdin: !!child.stdin
      })}`);
      
      return child;
    };

    const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
    const preferNodeForInput = isBun && needsExplicitPipe;
    trace('ProcessRunner', () => `About to spawn process | ${JSON.stringify({ 
      needsExplicitPipe, 
      preferNodeForInput, 
      runtime: isBun ? 'Bun' : 'Node',
      command: argv[0],
      args: argv.slice(1)
    }, null, 2)}`);
    this.child = preferNodeForInput ? await spawnNode(argv) : (isBun ? spawnBun(argv) : await spawnNode(argv));
    
    // Add detailed logging for CI debugging
    if (this.child) {
      trace('ProcessRunner', () => `Child process created | ${JSON.stringify({ 
        pid: this.child.pid, 
        detached: this.child.options?.detached,
        killed: this.child.killed,
        exitCode: this.child.exitCode,
        signalCode: this.child.signalCode,
        hasStdout: !!this.child.stdout,
        hasStderr: !!this.child.stderr,
        hasStdin: !!this.child.stdin,
        platform: process.platform,
        command: this.spec?.command?.slice(0, 100)
      }, null, 2)}`);
      
      // Add event listeners with detailed tracing (only for Node.js child processes)
      if (this.child && typeof this.child.on === 'function') {
        this.child.on('spawn', () => {
          trace('ProcessRunner', () => `Child process spawned successfully | ${JSON.stringify({
            pid: this.child.pid,
            command: this.spec?.command?.slice(0, 50)
          }, null, 2)}`);
        });
        
        this.child.on('error', (error) => {
          trace('ProcessRunner', () => `Child process error event | ${JSON.stringify({
            pid: this.child?.pid,
            error: error.message,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            command: this.spec?.command?.slice(0, 50)
          }, null, 2)}`);
        });
      } else {
        trace('ProcessRunner', () => `Skipping event listeners - child does not support .on() method (likely Bun process)`);
      }
    } else {
      trace('ProcessRunner', () => `No child process created | ${JSON.stringify({
        spec: this.spec,
        hasVirtualGenerator: !!this._virtualGenerator
      }, null, 2)}`);
    }

    // For interactive commands with stdio: 'inherit', stdout/stderr will be null
    const childPid = this.child?.pid; // Capture PID once at the start
    const outPump = this.child.stdout ? pumpReadable(this.child.stdout, async (buf) => {
      trace('ProcessRunner', () => `stdout data received | ${JSON.stringify({
        pid: childPid,
        bufferLength: buf.length,
        capture: this.options.capture,
        mirror: this.options.mirror,
        preview: buf.toString().slice(0, 100)
      })}`);
      
      if (this.options.capture) this.outChunks.push(buf);
      if (this.options.mirror) safeWrite(process.stdout, buf);

      // Emit chunk events
      this._emitProcessedData('stdout', buf);
    }) : Promise.resolve();

    const errPump = this.child.stderr ? pumpReadable(this.child.stderr, async (buf) => {
      trace('ProcessRunner', () => `stderr data received | ${JSON.stringify({
        pid: childPid,
        bufferLength: buf.length,
        capture: this.options.capture,
        mirror: this.options.mirror,
        preview: buf.toString().slice(0, 100)
      })}`);
      
      if (this.options.capture) this.errChunks.push(buf);
      if (this.options.mirror) safeWrite(process.stderr, buf);

      // Emit chunk events
      this._emitProcessedData('stderr', buf);
    }) : Promise.resolve();

    let stdinPumpPromise = Promise.resolve();
    trace('ProcessRunner', () => `Setting up stdin handling | ${JSON.stringify({
      stdinType: typeof stdin,
      stdin: stdin === 'inherit' ? 'inherit' : stdin === 'ignore' ? 'ignore' : (typeof stdin === 'string' ? `string(${stdin.length})` : 'other'),
      isInteractive,
      hasChildStdin: !!this.child?.stdin,
      processTTY: process.stdin.isTTY
    }, null, 2)}`);
    
    if (stdin === 'inherit') {
      if (isInteractive) {
        // For interactive commands with stdio: 'inherit', stdin is handled automatically
        trace('ProcessRunner', () => `stdin: Using inherit mode for interactive command`);
        stdinPumpPromise = Promise.resolve();
      } else {
        const isPipedIn = process.stdin && process.stdin.isTTY === false;
        trace('ProcessRunner', () => `stdin: Non-interactive inherit mode | ${JSON.stringify({
          isPipedIn,
          stdinTTY: process.stdin.isTTY
        }, null, 2)}`);
        if (isPipedIn) {
          trace('ProcessRunner', () => `stdin: Pumping piped input to child process`);
          stdinPumpPromise = this._pumpStdinTo(this.child, this.options.capture ? this.inChunks : null);
        } else {
          // For TTY (interactive terminal), forward stdin directly for non-interactive commands
          trace('ProcessRunner', () => `stdin: Forwarding TTY stdin for non-interactive command`);
          stdinPumpPromise = this._forwardTTYStdin();
        }
      }
    } else if (stdin === 'ignore') {
      trace('ProcessRunner', () => `stdin: Ignoring and closing stdin`);
      if (this.child.stdin && typeof this.child.stdin.end === 'function') {
        this.child.stdin.end();
        trace('ProcessRunner', () => `stdin: Child stdin closed successfully`);
      }
    } else if (stdin === 'pipe') {
      trace('ProcessRunner', () => `stdin: Using pipe mode - leaving stdin open for manual control`);
      // Leave stdin open for manual writing via streams.stdin
      stdinPumpPromise = Promise.resolve();
    } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
      const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
      trace('ProcessRunner', () => `stdin: Writing buffer to child | ${JSON.stringify({
        bufferLength: buf.length,
        willCapture: this.options.capture && !!this.inChunks
      }, null, 2)}`);
      if (this.options.capture && this.inChunks) this.inChunks.push(Buffer.from(buf));
      stdinPumpPromise = this._writeToStdin(buf);
    } else {
      trace('ProcessRunner', () => `stdin: Unhandled stdin type: ${typeof stdin}`);
    }

    const exited = isBun ? this.child.exited : new Promise((resolve) => {
      trace('ProcessRunner', () => `Setting up child process event listeners for PID ${this.child.pid}`);
      this.child.on('close', (code, signal) => {
        trace('ProcessRunner', () => `Child process close event | ${JSON.stringify({ 
          pid: this.child.pid, 
          code, 
          signal,
          killed: this.child.killed,
          exitCode: this.child.exitCode,
          signalCode: this.child.signalCode,
          command: this.command 
        }, null, 2)}`);
        resolve(code);
      });
      this.child.on('exit', (code, signal) => {
        trace('ProcessRunner', () => `Child process exit event | ${JSON.stringify({ 
          pid: this.child.pid, 
          code, 
          signal,
          killed: this.child.killed,
          exitCode: this.child.exitCode,
          signalCode: this.child.signalCode,
          command: this.command 
        }, null, 2)}`);
      });
    });
    const code = await exited;
    await Promise.all([outPump, errPump, stdinPumpPromise]);

    // Debug: Check the raw exit code
    trace('ProcessRunner', () => `Raw exit code from child | ${JSON.stringify({
      code,
      codeType: typeof code,
      childExitCode: this.child?.exitCode,
      isBun
    }, null, 2)}`);

    // When a process is killed, it may not have an exit code
    // If cancelled and no exit code, assume it was killed with SIGTERM
    let finalExitCode = code;
    trace('ProcessRunner', () => `Processing exit code | ${JSON.stringify({
      rawCode: code,
      cancelled: this._cancelled,
      childKilled: this.child?.killed,
      childExitCode: this.child?.exitCode,
      childSignalCode: this.child?.signalCode
    }, null, 2)}`);
    
    if (finalExitCode === undefined || finalExitCode === null) {
      if (this._cancelled) {
        // Process was killed, use SIGTERM exit code
        finalExitCode = 143; // 128 + 15 (SIGTERM)
        trace('ProcessRunner', () => `Process was killed, using SIGTERM exit code 143`);
      } else {
        // Process exited without a code, default to 0
        finalExitCode = 0;
        trace('ProcessRunner', () => `Process exited without code, defaulting to 0`);
      }
    }

    const resultData = {
      code: finalExitCode,
      stdout: this.options.capture ? (this.outChunks && this.outChunks.length > 0 ? Buffer.concat(this.outChunks).toString('utf8') : '') : undefined,
      stderr: this.options.capture ? (this.errChunks && this.errChunks.length > 0 ? Buffer.concat(this.errChunks).toString('utf8') : '') : undefined,
      stdin: this.options.capture && this.inChunks ? Buffer.concat(this.inChunks).toString('utf8') : undefined,
      child: this.child
    };
    
    trace('ProcessRunner', () => `Process completed | ${JSON.stringify({
      command: this.command,
      finalExitCode,
      captured: this.options.capture,
      hasStdout: !!resultData.stdout,
      hasStderr: !!resultData.stderr,
      stdoutLength: resultData.stdout?.length || 0,
      stderrLength: resultData.stderr?.length || 0,
      stdoutPreview: resultData.stdout?.slice(0, 100),
      stderrPreview: resultData.stderr?.slice(0, 100),
      childPid: this.child?.pid,
      cancelled: this._cancelled,
      cancellationSignal: this._cancellationSignal,
      platform: process.platform,
      runtime: isBun ? 'Bun' : 'Node.js'
    }, null, 2)}`);

    const result = {
      ...resultData,
      async text() {
        return resultData.stdout || '';
      }
    };

    trace('ProcessRunner', () => `About to finish process with result | ${JSON.stringify({
      exitCode: result.code,
      finished: this.finished
    }, null, 2)}`);
    
    // Finish the process with proper event emission order
    this.finish(result);
    
    trace('ProcessRunner', () => `Process finished, result set | ${JSON.stringify({
      finished: this.finished,
      resultCode: this.result?.code
    }, null, 2)}`);

    if (globalShellSettings.errexit && this.result.code !== 0) {
      trace('ProcessRunner', () => `Errexit mode: throwing error for non-zero exit code | ${JSON.stringify({
        exitCode: this.result.code,
        errexit: globalShellSettings.errexit,
        hasStdout: !!this.result.stdout,
        hasStderr: !!this.result.stderr
      }, null, 2)}`);
      
      const error = new Error(`Command failed with exit code ${this.result.code}`);
      error.code = this.result.code;
      error.stdout = this.result.stdout;
      error.stderr = this.result.stderr;
      error.result = this.result;
      
      trace('ProcessRunner', () => `About to throw errexit error`);
      throw error;
    }
    
    trace('ProcessRunner', () => `Returning result successfully | ${JSON.stringify({
      exitCode: this.result.code,
      errexit: globalShellSettings.errexit
    }, null, 2)}`);

    return this.result;
    } catch (error) {
      trace('ProcessRunner', () => `Caught error in _doStartAsync | ${JSON.stringify({
        errorMessage: error.message,
        errorCode: error.code,
        isCommandError: error.isCommandError,
        hasResult: !!error.result,
        command: this.spec?.command?.slice(0, 100)
      }, null, 2)}`);
      
      // Ensure cleanup happens even if execution fails
      trace('ProcessRunner', () => `_doStartAsync caught error: ${error.message}`);
      
      if (!this.finished) {
        // Create a result from the error
        const errorResult = createResult({
          code: error.code ?? 1,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? error.message ?? '',
          stdin: ''
        });
        
        // Finish to trigger cleanup
        this.finish(errorResult);
      }
      
      // Re-throw the error after cleanup
      throw error;
    }
  }

  async _pumpStdinTo(child, captureChunks) {
    trace('ProcessRunner', () => `_pumpStdinTo ENTER | ${JSON.stringify({
      hasChildStdin: !!child?.stdin,
      willCapture: !!captureChunks,
      isBun
    }, null, 2)}`);
    
    if (!child.stdin) {
      trace('ProcessRunner', () => 'No child stdin to pump to');
      return;
    }
    const bunWriter = isBun && child.stdin && typeof child.stdin.getWriter === 'function' ? child.stdin.getWriter() : null;
    for await (const chunk of process.stdin) {
      const buf = asBuffer(chunk);
      captureChunks && captureChunks.push(buf);
      if (bunWriter) await bunWriter.write(buf);
      else if (typeof child.stdin.write === 'function') {
        // Use StreamUtils for consistent stdin handling
        StreamUtils.addStdinErrorHandler(child.stdin, 'child stdin buffer');
        StreamUtils.safeStreamWrite(child.stdin, buf, 'child stdin buffer');
      }
      else if (isBun && typeof Bun.write === 'function') await Bun.write(child.stdin, buf);
    }
    if (bunWriter) await bunWriter.close();
    else if (typeof child.stdin.end === 'function') child.stdin.end();
  }

  async _writeToStdin(buf) {
    trace('ProcessRunner', () => `_writeToStdin ENTER | ${JSON.stringify({
      bufferLength: buf?.length || 0,
      hasChildStdin: !!this.child?.stdin
    }, null, 2)}`);
    
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);
    if (await StreamUtils.writeToStream(this.child.stdin, bytes, 'stdin')) {
      // Successfully wrote to stream
      if (StreamUtils.isBunStream(this.child.stdin)) {
        // Stream was already closed by writeToStream utility
      } else if (StreamUtils.isNodeStream(this.child.stdin)) {
        try { this.child.stdin.end(); } catch { }
      }
    } else if (isBun && typeof Bun.write === 'function') {
      await Bun.write(this.child.stdin, buf);
    }
  }

  _parseCommand(command) {
    trace('ProcessRunner', () => `_parseCommand ENTER | ${JSON.stringify({
      commandLength: command?.length || 0,
      preview: command?.slice(0, 50)
    }, null, 2)}`);
    
    const trimmed = command.trim();
    if (!trimmed) {
      trace('ProcessRunner', () => 'Empty command after trimming');
      return null;
    }

    if (trimmed.includes('|')) {
      return this._parsePipeline(trimmed);
    }

    // Simple command parsing
    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (parts.length === 0) return null;

    const cmd = parts[0];
    const args = parts.slice(1).map(arg => {
      // Keep track of whether the arg was quoted
      if ((arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))) {
        return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
      }
      return { value: arg, quoted: false };
    });

    return { cmd, args, type: 'simple' };
  }

  _parsePipeline(command) {
    trace('ProcessRunner', () => `_parsePipeline ENTER | ${JSON.stringify({
      commandLength: command?.length || 0,
      hasPipe: command?.includes('|')
    }, null, 2)}`);
    
    // Split by pipe, respecting quotes
    const segments = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else if (!inQuotes && char === '|') {
        segments.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    const commands = segments.map(segment => {
      const parts = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      if (parts.length === 0) return null;

      const cmd = parts[0];
      const args = parts.slice(1).map(arg => {
        // Keep track of whether the arg was quoted
        if ((arg.startsWith('"') && arg.endsWith('"')) ||
          (arg.startsWith("'") && arg.endsWith("'"))) {
          return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
        }
        return { value: arg, quoted: false };
      });

      return { cmd, args };
    }).filter(Boolean);

    return { type: 'pipeline', commands };
  }

  async _runVirtual(cmd, args, originalCommand = null) {
    trace('ProcessRunner', () => `_runVirtual ENTER | ${JSON.stringify({ cmd, args, originalCommand }, null, 2)}`);

    const handler = virtualCommands.get(cmd);
    if (!handler) {
      trace('ProcessRunner', () => `Virtual command not found | ${JSON.stringify({ cmd }, null, 2)}`);
      throw new Error(`Virtual command not found: ${cmd}`);
    }

    trace('ProcessRunner', () => `Found virtual command handler | ${JSON.stringify({
      cmd,
      isGenerator: handler.constructor.name === 'AsyncGeneratorFunction'
    }, null, 2)}`);

    try {
      // Prepare stdin
      let stdinData = '';
      
      // Special handling for streaming mode (stdin: "pipe")
      if (this.options.stdin === 'pipe') {
        // For streaming interfaces, virtual commands should fallback to real commands
        // because virtual commands don't support true streaming
        trace('ProcessRunner', () => `Virtual command fallback for streaming | ${JSON.stringify({ cmd }, null, 2)}`);
        
        // Create a new ProcessRunner for the real command with properly merged options
        // Preserve main options but use appropriate stdin for the real command
        const modifiedOptions = { 
          ...this.options, 
          stdin: 'pipe', // Keep pipe but ensure it doesn't trigger virtual command fallback
          _bypassVirtual: true // Flag to prevent virtual command recursion
        };
        const realRunner = new ProcessRunner({ mode: 'shell', command: originalCommand || cmd }, modifiedOptions);
        return await realRunner._doStartAsync();
      } else if (this.options.stdin && typeof this.options.stdin === 'string') {
        stdinData = this.options.stdin;
      } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
        stdinData = this.options.stdin.toString('utf8');
      }

      // Extract actual values for virtual command
      const argValues = args.map(arg => arg.value !== undefined ? arg.value : arg);

      // Shell tracing for virtual commands
      if (globalShellSettings.xtrace) {
        console.log(`+ ${originalCommand || `${cmd} ${argValues.join(' ')}`}`);
      }
      if (globalShellSettings.verbose) {
        console.log(`${originalCommand || `${cmd} ${argValues.join(' ')}`}`);
      }

      let result;

      if (handler.constructor.name === 'AsyncGeneratorFunction') {
        const chunks = [];

        const commandOptions = {
          // Commonly used options at top level for convenience
          cwd: this.options.cwd,
          env: this.options.env,
          // All original options (built-in + custom) in options object
          options: this.options,
          isCancelled: () => this._cancelled
        };
        
        trace('ProcessRunner', () => `_runVirtual signal details | ${JSON.stringify({
          cmd,
          hasAbortController: !!this._abortController,
          signalAborted: this._abortController?.signal?.aborted,
          optionsSignalExists: !!this.options.signal,
          optionsSignalAborted: this.options.signal?.aborted
        }, null, 2)}`);

        const generator = handler({ 
          args: argValues, 
          stdin: stdinData, 
          abortSignal: this._abortController?.signal,
          ...commandOptions 
        });
        this._virtualGenerator = generator;

        const cancelPromise = new Promise(resolve => {
          this._cancelResolve = resolve;
        });

        try {
          const iterator = generator[Symbol.asyncIterator]();
          let done = false;

          while (!done && !this._cancelled) {
            trace('ProcessRunner', () => `Virtual command iteration starting | ${JSON.stringify({
              cancelled: this._cancelled,
              streamBreaking: this._streamBreaking
            }, null, 2)}`);
            
            const result = await Promise.race([
              iterator.next(),
              cancelPromise.then(() => ({ done: true, cancelled: true }))
            ]);

            trace('ProcessRunner', () => `Virtual command iteration result | ${JSON.stringify({
              hasValue: !!result.value,
              done: result.done,
              cancelled: result.cancelled || this._cancelled
            }, null, 2)}`);

            if (result.cancelled || this._cancelled) {
              trace('ProcessRunner', () => `Virtual command cancelled - closing generator | ${JSON.stringify({
                resultCancelled: result.cancelled,
                thisCancelled: this._cancelled
              }, null, 2)}`);
              // Cancelled - close the generator
              if (iterator.return) {
                await iterator.return();
              }
              break;
            }

            done = result.done;

            if (!done) {
              // Check cancellation again before processing the chunk
              if (this._cancelled) {
                trace('ProcessRunner', () => 'Skipping chunk processing - cancelled during iteration');
                break;
              }
              
              const chunk = result.value;
              const buf = Buffer.from(chunk);
              
              // Check cancelled flag once more before any output
              if (this._cancelled || this._streamBreaking) {
                trace('ProcessRunner', () => `Cancelled or stream breaking before output - skipping | ${JSON.stringify({ 
                  cancelled: this._cancelled, 
                  streamBreaking: this._streamBreaking 
                }, null, 2)}`);
                break;
              }
              
              chunks.push(buf);

              // Only output if not cancelled and stream not breaking
              if (!this._cancelled && !this._streamBreaking && this.options.mirror) {
                trace('ProcessRunner', () => `Mirroring virtual command output | ${JSON.stringify({ 
                  chunkSize: buf.length 
                }, null, 2)}`);
                safeWrite(process.stdout, buf);
              }

              this._emitProcessedData('stdout', buf);
            }
          }
        } finally {
          // Clean up
          this._virtualGenerator = null;
          this._cancelResolve = null;
        }

        result = {
          code: 0,
          stdout: this.options.capture ? Buffer.concat(chunks).toString('utf8') : undefined,
          stderr: this.options.capture ? '' : undefined,
          stdin: this.options.capture ? stdinData : undefined
        };
      } else {
        // Regular async function - race with abort signal
        const commandOptions = {
          // Commonly used options at top level for convenience
          cwd: this.options.cwd,
          env: this.options.env,
          // All original options (built-in + custom) in options object
          options: this.options,
          isCancelled: () => this._cancelled
        };
        
        trace('ProcessRunner', () => `_runVirtual signal details (non-generator) | ${JSON.stringify({
          cmd,
          hasAbortController: !!this._abortController,
          signalAborted: this._abortController?.signal?.aborted,
          optionsSignalExists: !!this.options.signal,
          optionsSignalAborted: this.options.signal?.aborted
        }, null, 2)}`);
        
        const handlerPromise = handler({ 
          args: argValues, 
          stdin: stdinData, 
          abortSignal: this._abortController?.signal,
          ...commandOptions 
        });
        
        // Create an abort promise that rejects when cancelled
        const abortPromise = new Promise((_, reject) => {
          if (this._abortController && this._abortController.signal.aborted) {
            reject(new Error('Command cancelled'));
          }
          if (this._abortController) {
            this._abortController.signal.addEventListener('abort', () => {
              reject(new Error('Command cancelled'));
            });
          }
        });
        
        try {
          result = await Promise.race([handlerPromise, abortPromise]);
        } catch (err) {
          if (err.message === 'Command cancelled') {
            // Command was cancelled, return appropriate exit code based on signal
            const exitCode = this._cancellationSignal === 'SIGINT' ? 130 : 143; // 130 for SIGINT, 143 for SIGTERM
            trace('ProcessRunner', () => `Virtual command cancelled with signal ${this._cancellationSignal}, exit code: ${exitCode}`);
            result = { 
              code: exitCode,
              stdout: '',
              stderr: ''
            };
          } else {
            throw err;
          }
        }

        result = {
          ...result,
          code: result.code ?? 0,
          stdout: this.options.capture ? (result.stdout ?? '') : undefined,
          stderr: this.options.capture ? (result.stderr ?? '') : undefined,
          stdin: this.options.capture ? stdinData : undefined
        };

        // Mirror and emit output
        if (result.stdout) {
          const buf = Buffer.from(result.stdout);
          if (this.options.mirror) {
            safeWrite(process.stdout, buf);
          }
          this._emitProcessedData('stdout', buf);
        }

        if (result.stderr) {
          const buf = Buffer.from(result.stderr);
          if (this.options.mirror) {
            safeWrite(process.stderr, buf);
          }
          this._emitProcessedData('stderr', buf);
        }
      }

      // Finish the process with proper event emission order
      this.finish(result);

      if (globalShellSettings.errexit && result.code !== 0) {
        const error = new Error(`Command failed with exit code ${result.code}`);
        error.code = result.code;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        error.result = result;
        throw error;
      }

      return result;
    } catch (error) {
      // Check if this is a cancellation error
      let exitCode = error.code ?? 1;
      if (this._cancelled && this._cancellationSignal) {
        // Use appropriate exit code based on the signal
        exitCode = this._cancellationSignal === 'SIGINT' ? 130 : 
                   this._cancellationSignal === 'SIGTERM' ? 143 : 1;
        trace('ProcessRunner', () => `Virtual command error during cancellation, using signal-based exit code: ${exitCode}`);
      }
      
      const result = {
        code: exitCode,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        stdin: ''
      };

      if (result.stderr) {
        const buf = Buffer.from(result.stderr);
        if (this.options.mirror) {
          safeWrite(process.stderr, buf);
        }
        this._emitProcessedData('stderr', buf);
      }

      this.finish(result);

      if (globalShellSettings.errexit) {
        error.result = result;
        throw error;
      }

      return result;
    }
  }

  async _runStreamingPipelineBun(commands) {
    trace('ProcessRunner', () => `_runStreamingPipelineBun ENTER | ${JSON.stringify({
      commandsCount: commands.length
    }, null, 2)}`);

    // For true streaming, we need to handle virtual and real commands differently

    // First, analyze the pipeline to identify virtual vs real commands
    const pipelineInfo = commands.map(command => {
      const { cmd, args } = command;
      const isVirtual = virtualCommandsEnabled && virtualCommands.has(cmd);
      return { ...command, isVirtual };
    });

    trace('ProcessRunner', () => `Pipeline analysis | ${JSON.stringify({
      virtualCount: pipelineInfo.filter(p => p.isVirtual).length,
      realCount: pipelineInfo.filter(p => !p.isVirtual).length
    }, null, 2)}`);

    // If pipeline contains virtual commands, use advanced streaming
    if (pipelineInfo.some(info => info.isVirtual)) {
      trace('ProcessRunner', () => `BRANCH: _runStreamingPipelineBun => MIXED_PIPELINE | ${JSON.stringify({}, null, 2)}`);
      return this._runMixedStreamingPipeline(commands);
    }

    // For pipelines with commands that buffer (like jq), use tee streaming
    const needsStreamingWorkaround = commands.some(c =>
      c.cmd === 'jq' || c.cmd === 'grep' || c.cmd === 'sed' || c.cmd === 'cat' || c.cmd === 'awk'
    );
    if (needsStreamingWorkaround) {
      trace('ProcessRunner', () => `BRANCH: _runStreamingPipelineBun => TEE_STREAMING | ${JSON.stringify({
        bufferedCommands: commands.filter(c =>
          ['jq', 'grep', 'sed', 'cat', 'awk'].includes(c.cmd)
        ).map(c => c.cmd)
      }, null, 2)}`);
      return this._runTeeStreamingPipeline(commands);
    }

    // All real commands - use native pipe connections
    const processes = [];
    let allStderr = '';

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

      // Build command string
      const commandParts = [cmd];
      for (const arg of args) {
        if (arg.value !== undefined) {
          if (arg.quoted) {
            commandParts.push(`${arg.quoteChar}${arg.value}${arg.quoteChar}`);
          } else if (arg.value.includes(' ')) {
            commandParts.push(`"${arg.value}"`);
          } else {
            commandParts.push(arg.value);
          }
        } else {
          if (typeof arg === 'string' && arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            commandParts.push(`"${arg}"`);
          } else {
            commandParts.push(arg);
          }
        }
      }
      const commandStr = commandParts.join(' ');

      // Determine stdin for this process
      let stdin;
      let needsManualStdin = false;
      let stdinData;

      if (i === 0) {
        // First command - use provided stdin or pipe
        if (this.options.stdin && typeof this.options.stdin === 'string') {
          stdin = 'pipe';
          needsManualStdin = true;
          stdinData = Buffer.from(this.options.stdin);
        } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
          stdin = 'pipe';
          needsManualStdin = true;
          stdinData = this.options.stdin;
        } else {
          stdin = 'ignore';
        }
      } else {
        // Connect to previous process stdout
        stdin = processes[i - 1].stdout;
      }

      // Only use sh -c for complex commands that need shell features
      const needsShell = commandStr.includes('*') || commandStr.includes('$') ||
        commandStr.includes('>') || commandStr.includes('<') ||
        commandStr.includes('&&') || commandStr.includes('||') ||
        commandStr.includes(';') || commandStr.includes('`');

      const shell = findAvailableShell();
      const spawnArgs = needsShell
        ? [shell.cmd, ...shell.args.filter(arg => arg !== '-l'), commandStr]
        : [cmd, ...args.map(a => a.value !== undefined ? a.value : a)];

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin: stdin,
        stdout: 'pipe',
        stderr: 'pipe'
      });

      // Write stdin data if needed for first process
      if (needsManualStdin && stdinData && proc.stdin) {
        // Use StreamUtils for consistent stdin handling
        const stdinHandler = StreamUtils.setupStdinHandling(proc.stdin, 'Bun process stdin');

        (async () => {
          try {
            if (stdinHandler.isWritable()) {
              await proc.stdin.write(stdinData); // Bun's FileSink async write
              await proc.stdin.end();
            }
          } catch (e) {
            if (e.code !== 'EPIPE') {
              trace('ProcessRunner', () => `Error with Bun stdin async operations | ${JSON.stringify({ error: e.message, code: e.code }, null, 2)}`);
            }
          }
        })();
      }

      processes.push(proc);

      // Collect stderr from all processes
      (async () => {
        for await (const chunk of proc.stderr) {
          const buf = Buffer.from(chunk);
          allStderr += buf.toString();
          // Only emit stderr for the last command
          if (i === commands.length - 1) {
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }
        }
      })();
    }

    // Stream output from the last process
    const lastProc = processes[processes.length - 1];
    let finalOutput = '';

    // Stream stdout from last process
    for await (const chunk of lastProc.stdout) {
      const buf = Buffer.from(chunk);
      finalOutput += buf.toString();
      if (this.options.mirror) {
        safeWrite(process.stdout, buf);
      }
      this._emitProcessedData('stdout', buf);
    }

    // Wait for all processes to complete
    const exitCodes = await Promise.all(processes.map(p => p.exited));
    const lastExitCode = exitCodes[exitCodes.length - 1];

    if (globalShellSettings.pipefail) {
      const failedIndex = exitCodes.findIndex(code => code !== 0);
      if (failedIndex !== -1) {
        const error = new Error(`Pipeline command at index ${failedIndex} failed with exit code ${exitCodes[failedIndex]}`);
        error.code = exitCodes[failedIndex];
        throw error;
      }
    }

    const result = createResult({
      code: lastExitCode || 0,
      stdout: finalOutput,
      stderr: allStderr,
      stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
        this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
    });

    // Finish the process with proper event emission order
    this.finish(result);

    if (globalShellSettings.errexit && result.code !== 0) {
      const error = new Error(`Pipeline failed with exit code ${result.code}`);
      error.code = result.code;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      error.result = result;
      throw error;
    }

    return result;
  }

  async _runTeeStreamingPipeline(commands) {
    trace('ProcessRunner', () => `_runTeeStreamingPipeline ENTER | ${JSON.stringify({
      commandsCount: commands.length
    }, null, 2)}`);

    // Use tee() to split streams for real-time reading
    // This works around jq and similar commands that buffer when piped

    const processes = [];
    let allStderr = '';
    let currentStream = null;

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

      // Build command string
      const commandParts = [cmd];
      for (const arg of args) {
        if (arg.value !== undefined) {
          if (arg.quoted) {
            commandParts.push(`${arg.quoteChar}${arg.value}${arg.quoteChar}`);
          } else if (arg.value.includes(' ')) {
            commandParts.push(`"${arg.value}"`);
          } else {
            commandParts.push(arg.value);
          }
        } else {
          if (typeof arg === 'string' && arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            commandParts.push(`"${arg}"`);
          } else {
            commandParts.push(arg);
          }
        }
      }
      const commandStr = commandParts.join(' ');

      // Determine stdin for this process
      let stdin;
      let needsManualStdin = false;
      let stdinData;

      if (i === 0) {
        // First command - use provided stdin or ignore
        if (this.options.stdin && typeof this.options.stdin === 'string') {
          stdin = 'pipe';
          needsManualStdin = true;
          stdinData = Buffer.from(this.options.stdin);
        } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
          stdin = 'pipe';
          needsManualStdin = true;
          stdinData = this.options.stdin;
        } else {
          stdin = 'ignore';
        }
      } else {
        stdin = currentStream;
      }

      const needsShell = commandStr.includes('*') || commandStr.includes('$') ||
        commandStr.includes('>') || commandStr.includes('<') ||
        commandStr.includes('&&') || commandStr.includes('||') ||
        commandStr.includes(';') || commandStr.includes('`');

      const shell = findAvailableShell();
      const spawnArgs = needsShell
        ? [shell.cmd, ...shell.args.filter(arg => arg !== '-l'), commandStr]
        : [cmd, ...args.map(a => a.value !== undefined ? a.value : a)];

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin: stdin,
        stdout: 'pipe',
        stderr: 'pipe'
      });

      // Write stdin data if needed for first process
      if (needsManualStdin && stdinData && proc.stdin) {
        // Use StreamUtils for consistent stdin handling
        const stdinHandler = StreamUtils.setupStdinHandling(proc.stdin, 'Node process stdin');

        try {
          if (stdinHandler.isWritable()) {
            await proc.stdin.write(stdinData); // Node async write
            await proc.stdin.end();
          }
        } catch (e) {
          if (e.code !== 'EPIPE') {
            trace('ProcessRunner', () => `Error with Node stdin async operations | ${JSON.stringify({ error: e.message, code: e.code }, null, 2)}`);
          }
        }
      }

      processes.push(proc);

      // For non-last processes, tee the output so we can both pipe and read
      if (i < commands.length - 1) {
        const [readStream, pipeStream] = proc.stdout.tee();
        currentStream = pipeStream;

        // Read from the tee'd stream to keep it flowing
        (async () => {
          for await (const chunk of readStream) {
            // Just consume to keep flowing - don't emit intermediate output
          }
        })();
      } else {
        currentStream = proc.stdout;
      }

      // Collect stderr from all processes
      (async () => {
        for await (const chunk of proc.stderr) {
          const buf = Buffer.from(chunk);
          allStderr += buf.toString();
          if (i === commands.length - 1) {
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }
        }
      })();
    }

    // Read final output from the last process
    const lastProc = processes[processes.length - 1];
    let finalOutput = '';

    // Always emit from the last process for proper pipeline output
    for await (const chunk of lastProc.stdout) {
      const buf = Buffer.from(chunk);
      finalOutput += buf.toString();
      if (this.options.mirror) {
        safeWrite(process.stdout, buf);
      }
      this._emitProcessedData('stdout', buf);
    }

    // Wait for all processes to complete
    const exitCodes = await Promise.all(processes.map(p => p.exited));
    const lastExitCode = exitCodes[exitCodes.length - 1];

    if (globalShellSettings.pipefail) {
      const failedIndex = exitCodes.findIndex(code => code !== 0);
      if (failedIndex !== -1) {
        const error = new Error(`Pipeline command at index ${failedIndex} failed with exit code ${exitCodes[failedIndex]}`);
        error.code = exitCodes[failedIndex];
        throw error;
      }
    }

    const result = createResult({
      code: lastExitCode || 0,
      stdout: finalOutput,
      stderr: allStderr,
      stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
        this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
    });

    // Finish the process with proper event emission order
    this.finish(result);

    if (globalShellSettings.errexit && result.code !== 0) {
      const error = new Error(`Pipeline failed with exit code ${result.code}`);
      error.code = result.code;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      error.result = result;
      throw error;
    }

    return result;
  }


  async _runMixedStreamingPipeline(commands) {
    trace('ProcessRunner', () => `_runMixedStreamingPipeline ENTER | ${JSON.stringify({
      commandsCount: commands.length
    }, null, 2)}`);

    // Each stage reads from previous stage's output stream

    let currentInputStream = null;
    let finalOutput = '';
    let allStderr = '';

    if (this.options.stdin) {
      const inputData = typeof this.options.stdin === 'string'
        ? this.options.stdin
        : this.options.stdin.toString('utf8');

      currentInputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(inputData));
          controller.close();
        }
      });
    }

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;
      const isLastCommand = i === commands.length - 1;

      if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
        trace('ProcessRunner', () => `BRANCH: _runMixedStreamingPipeline => VIRTUAL_COMMAND | ${JSON.stringify({
          cmd,
          commandIndex: i
        }, null, 2)}`);
        const handler = virtualCommands.get(cmd);
        const argValues = args.map(arg => arg.value !== undefined ? arg.value : arg);

        // Read input from stream if available
        let inputData = '';
        if (currentInputStream) {
          const reader = currentInputStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              inputData += new TextDecoder().decode(value);
            }
          } finally {
            reader.releaseLock();
          }
        }

        if (handler.constructor.name === 'AsyncGeneratorFunction') {
          const chunks = [];
          const self = this; // Capture this context
          currentInputStream = new ReadableStream({
            async start(controller) {
              const { stdin: _, ...optionsWithoutStdin } = self.options;
              for await (const chunk of handler({ args: argValues, stdin: inputData, ...optionsWithoutStdin })) {
                const data = Buffer.from(chunk);
                controller.enqueue(data);

                // Emit for last command
                if (isLastCommand) {
                  chunks.push(data);
                  if (self.options.mirror) {
                    safeWrite(process.stdout, data);
                  }
                  self.emit('stdout', data);
                  self.emit('data', { type: 'stdout', data });
                }
              }
              controller.close();

              if (isLastCommand) {
                finalOutput = Buffer.concat(chunks).toString('utf8');
              }
            }
          });
        } else {
          // Regular async function
          const { stdin: _, ...optionsWithoutStdin } = this.options;
          const result = await handler({ args: argValues, stdin: inputData, ...optionsWithoutStdin });
          const outputData = result.stdout || '';

          if (isLastCommand) {
            finalOutput = outputData;
            const buf = Buffer.from(outputData);
            if (this.options.mirror) {
              safeWrite(process.stdout, buf);
            }
            this._emitProcessedData('stdout', buf);
          }

          currentInputStream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(outputData));
              controller.close();
            }
          });

          if (result.stderr) {
            allStderr += result.stderr;
          }
        }
      } else {
        const commandParts = [cmd];
        for (const arg of args) {
          if (arg.value !== undefined) {
            if (arg.quoted) {
              commandParts.push(`${arg.quoteChar}${arg.value}${arg.quoteChar}`);
            } else if (arg.value.includes(' ')) {
              commandParts.push(`"${arg.value}"`);
            } else {
              commandParts.push(arg.value);
            }
          } else {
            if (typeof arg === 'string' && arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
              commandParts.push(`"${arg}"`);
            } else {
              commandParts.push(arg);
            }
          }
        }
        const commandStr = commandParts.join(' ');

        const shell = findAvailableShell();
        const proc = Bun.spawn([shell.cmd, ...shell.args.filter(arg => arg !== '-l'), commandStr], {
          cwd: this.options.cwd,
          env: this.options.env,
          stdin: currentInputStream ? 'pipe' : 'ignore',
          stdout: 'pipe',
          stderr: 'pipe'
        });

        // Write input stream to process stdin if needed
        if (currentInputStream && proc.stdin) {
          const reader = currentInputStream.getReader();
          const writer = proc.stdin.getWriter ? proc.stdin.getWriter() : proc.stdin;

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (writer.write) {
                  try {
                    await writer.write(value);
                  } catch (error) {
                    StreamUtils.handleStreamError(error, 'stream writer', false);
                    break; // Stop streaming if write fails
                  }
                } else if (writer.getWriter) {
                  try {
                    const w = writer.getWriter();
                    await w.write(value);
                    w.releaseLock();
                  } catch (error) {
                    StreamUtils.handleStreamError(error, 'stream writer (getWriter)', false);
                    break; // Stop streaming if write fails
                  }
                }
              }
            } finally {
              reader.releaseLock();
              if (writer.close) await writer.close();
              else if (writer.end) writer.end();
            }
          })();
        }

        currentInputStream = proc.stdout;

        (async () => {
          for await (const chunk of proc.stderr) {
            const buf = Buffer.from(chunk);
            allStderr += buf.toString();
            if (isLastCommand) {
              if (this.options.mirror) {
                safeWrite(process.stderr, buf);
              }
              this._emitProcessedData('stderr', buf);
            }
          }
        })();

        // For last command, stream output
        if (isLastCommand) {
          const chunks = [];
          for await (const chunk of proc.stdout) {
            const buf = Buffer.from(chunk);
            chunks.push(buf);
            if (this.options.mirror) {
              safeWrite(process.stdout, buf);
            }
            this._emitProcessedData('stdout', buf);
          }
          finalOutput = Buffer.concat(chunks).toString('utf8');
          await proc.exited;
        }
      }
    }

    const result = createResult({
      code: 0, // TODO: Track exit codes properly
      stdout: finalOutput,
      stderr: allStderr,
      stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
        this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
    });

    // Finish the process with proper event emission order
    this.finish(result);

    return result;
  }

  async _runPipelineNonStreaming(commands) {
    trace('ProcessRunner', () => `_runPipelineNonStreaming ENTER | ${JSON.stringify({
      commandsCount: commands.length
    }, null, 2)}`);

    let currentOutput = '';
    let currentInput = '';

    if (this.options.stdin && typeof this.options.stdin === 'string') {
      currentInput = this.options.stdin;
    } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
      currentInput = this.options.stdin.toString('utf8');
    }

    // Execute each command in the pipeline
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

      if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
        trace('ProcessRunner', () => `BRANCH: _runPipelineNonStreaming => VIRTUAL_COMMAND | ${JSON.stringify({
          cmd,
          argsCount: args.length
        }, null, 2)}`);

        // Run virtual command with current input
        const handler = virtualCommands.get(cmd);

        try {
          // Extract actual values for virtual command
          const argValues = args.map(arg => arg.value !== undefined ? arg.value : arg);

          // Shell tracing for virtual commands
          if (globalShellSettings.xtrace) {
            console.log(`+ ${cmd} ${argValues.join(' ')}`);
          }
          if (globalShellSettings.verbose) {
            console.log(`${cmd} ${argValues.join(' ')}`);
          }

          let result;

          if (handler.constructor.name === 'AsyncGeneratorFunction') {
            trace('ProcessRunner', () => `BRANCH: _runPipelineNonStreaming => ASYNC_GENERATOR | ${JSON.stringify({ cmd }, null, 2)}`);
            const chunks = [];
            for await (const chunk of handler({ args: argValues, stdin: currentInput, ...this.options })) {
              chunks.push(Buffer.from(chunk));
            }
            result = {
              code: 0,
              stdout: this.options.capture ? Buffer.concat(chunks).toString('utf8') : undefined,
              stderr: this.options.capture ? '' : undefined,
              stdin: this.options.capture ? currentInput : undefined
            };
          } else {
            // Regular async function
            result = await handler({ args: argValues, stdin: currentInput, ...this.options });
            result = {
              ...result,
              code: result.code ?? 0,
              stdout: this.options.capture ? (result.stdout ?? '') : undefined,
              stderr: this.options.capture ? (result.stderr ?? '') : undefined,
              stdin: this.options.capture ? currentInput : undefined
            };
          }

          // If this isn't the last command, pass stdout as stdin to next command
          if (i < commands.length - 1) {
            currentInput = result.stdout;
          } else {
            // This is the last command - emit output and store final result
            currentOutput = result.stdout;

            // Mirror and emit output for final command
            if (result.stdout) {
              const buf = Buffer.from(result.stdout);
              if (this.options.mirror) {
                safeWrite(process.stdout, buf);
              }
              this._emitProcessedData('stdout', buf);
            }

            if (result.stderr) {
              const buf = Buffer.from(result.stderr);
              if (this.options.mirror) {
                safeWrite(process.stderr, buf);
              }
              this._emitProcessedData('stderr', buf);
            }

            const finalResult = createResult({
              code: result.code,
              stdout: currentOutput,
              stderr: result.stderr,
              stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
                this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
            });

            // Finish the process with proper event emission order
            this.finish(finalResult);

            if (globalShellSettings.errexit && finalResult.code !== 0) {
              const error = new Error(`Pipeline failed with exit code ${finalResult.code}`);
              error.code = finalResult.code;
              error.stdout = finalResult.stdout;
              error.stderr = finalResult.stderr;
              error.result = finalResult;
              throw error;
            }

            return finalResult;
          }

          if (globalShellSettings.errexit && result.code !== 0) {
            const error = new Error(`Pipeline command failed with exit code ${result.code}`);
            error.code = result.code;
            error.stdout = result.stdout;
            error.stderr = result.stderr;
            error.result = result;
            throw error;
          }
        } catch (error) {
          const result = createResult({
            code: error.code ?? 1,
            stdout: currentOutput,
            stderr: error.stderr ?? error.message,
            stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
              this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
          });

          if (result.stderr) {
            const buf = Buffer.from(result.stderr);
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }

          this.finish(result);

          if (globalShellSettings.errexit) {
            throw error;
          }

          return result;
        }
      } else {
        // Execute system command in pipeline
        try {
          // Build command string for this part of the pipeline
          const commandParts = [cmd];
          for (const arg of args) {
            if (arg.value !== undefined) {
              if (arg.quoted) {
                // Preserve original quotes
                commandParts.push(`${arg.quoteChar}${arg.value}${arg.quoteChar}`);
              } else if (arg.value.includes(' ')) {
                // Quote if contains spaces
                commandParts.push(`"${arg.value}"`);
              } else {
                commandParts.push(arg.value);
              }
            } else {
              if (typeof arg === 'string' && arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
                commandParts.push(`"${arg}"`);
              } else {
                commandParts.push(arg);
              }
            }
          }
          const commandStr = commandParts.join(' ');

          // Shell tracing for system commands
          if (globalShellSettings.xtrace) {
            console.log(`+ ${commandStr}`);
          }
          if (globalShellSettings.verbose) {
            console.log(commandStr);
          }

          const spawnNodeAsync = async (argv, stdin, isLastCommand = false) => {

            return new Promise((resolve, reject) => {
              trace('ProcessRunner', () => `spawnNodeAsync: Creating child process | ${JSON.stringify({
                command: argv[0],
                args: argv.slice(1),
                cwd: this.options.cwd,
                isLastCommand
              })}`);
              
              const proc = cp.spawn(argv[0], argv.slice(1), {
                cwd: this.options.cwd,
                env: this.options.env,
                stdio: ['pipe', 'pipe', 'pipe']
              });

              trace('ProcessRunner', () => `spawnNodeAsync: Child process created | ${JSON.stringify({
                pid: proc.pid,
                killed: proc.killed,
                hasStdout: !!proc.stdout,
                hasStderr: !!proc.stderr
              })}`);

              let stdout = '';
              let stderr = '';
              let stdoutChunks = 0;
              let stderrChunks = 0;

              const procPid = proc.pid; // Capture PID once to avoid null reference
              
              proc.stdout.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                stdout += chunkStr;
                stdoutChunks++;
                
                trace('ProcessRunner', () => `spawnNodeAsync: stdout chunk received | ${JSON.stringify({
                  pid: procPid,
                  chunkNumber: stdoutChunks,
                  chunkLength: chunk.length,
                  totalStdoutLength: stdout.length,
                  isLastCommand,
                  preview: chunkStr.slice(0, 100)
                })}`);
                
                // If this is the last command, emit streaming data
                if (isLastCommand) {
                  if (this.options.mirror) {
                    safeWrite(process.stdout, chunk);
                  }
                  this._emitProcessedData('stdout', chunk);
                }
              });

              proc.stderr.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                stderr += chunkStr;
                stderrChunks++;
                
                trace('ProcessRunner', () => `spawnNodeAsync: stderr chunk received | ${JSON.stringify({
                  pid: procPid,
                  chunkNumber: stderrChunks,
                  chunkLength: chunk.length,
                  totalStderrLength: stderr.length,
                  isLastCommand,
                  preview: chunkStr.slice(0, 100)
                })}`);
                
                // If this is the last command, emit streaming data
                if (isLastCommand) {
                  if (this.options.mirror) {
                    safeWrite(process.stderr, chunk);
                  }
                  this._emitProcessedData('stderr', chunk);
                }
              });

              proc.on('close', (code) => {
                trace('ProcessRunner', () => `spawnNodeAsync: Process closed | ${JSON.stringify({
                  pid: procPid,
                  code,
                  stdoutLength: stdout.length,
                  stderrLength: stderr.length,
                  stdoutChunks,
                  stderrChunks
                })}`);
                
                resolve({
                  status: code,
                  stdout,
                  stderr
                });
              });

              proc.on('error', reject);

              // Use StreamUtils for comprehensive stdin handling
              if (proc.stdin) {
                StreamUtils.addStdinErrorHandler(proc.stdin, 'spawnNodeAsync stdin', reject);
              }

              if (stdin) {
                trace('ProcessRunner', () => `Attempting to write stdin to spawnNodeAsync | ${JSON.stringify({
                  hasStdin: !!proc.stdin,
                  writable: proc.stdin?.writable,
                  destroyed: proc.stdin?.destroyed,
                  closed: proc.stdin?.closed,
                  stdinLength: stdin.length
                }, null, 2)}`);

                StreamUtils.safeStreamWrite(proc.stdin, stdin, 'spawnNodeAsync stdin');
              }

              // Safely end the stdin stream
              StreamUtils.safeStreamEnd(proc.stdin, 'spawnNodeAsync stdin');
            });
          };

          // Execute using shell to handle complex commands
          const shell = findAvailableShell();
          const argv = [shell.cmd, ...shell.args.filter(arg => arg !== '-l'), commandStr];
          const isLastCommand = (i === commands.length - 1);
          const proc = await spawnNodeAsync(argv, currentInput, isLastCommand);

          let result = {
            code: proc.status || 0,
            stdout: proc.stdout || '',
            stderr: proc.stderr || '',
            stdin: currentInput
          };

          if (globalShellSettings.pipefail && result.code !== 0) {
            const error = new Error(`Pipeline command '${commandStr}' failed with exit code ${result.code}`);
            error.code = result.code;
            error.stdout = result.stdout;
            error.stderr = result.stderr;
            throw error;
          }

          // If this isn't the last command, pass stdout as stdin to next command
          if (i < commands.length - 1) {
            currentInput = result.stdout;
            // Accumulate stderr from all commands
            if (result.stderr && this.options.capture) {
              this.errChunks = this.errChunks || [];
              this.errChunks.push(Buffer.from(result.stderr));
            }
          } else {
            // This is the last command - store final result (streaming already handled during execution)
            currentOutput = result.stdout;

            // Collect all accumulated stderr
            let allStderr = '';
            if (this.errChunks && this.errChunks.length > 0) {
              allStderr = Buffer.concat(this.errChunks).toString('utf8');
            }
            if (result.stderr) {
              allStderr += result.stderr;
            }

            const finalResult = createResult({
              code: result.code,
              stdout: currentOutput,
              stderr: allStderr,
              stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
                this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
            });

            // Finish the process with proper event emission order
            this.finish(finalResult);

            if (globalShellSettings.errexit && finalResult.code !== 0) {
              const error = new Error(`Pipeline failed with exit code ${finalResult.code}`);
              error.code = finalResult.code;
              error.stdout = finalResult.stdout;
              error.stderr = finalResult.stderr;
              error.result = finalResult;
              throw error;
            }

            return finalResult;
          }

        } catch (error) {
          const result = createResult({
            code: error.code ?? 1,
            stdout: currentOutput,
            stderr: error.stderr ?? error.message,
            stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
              this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
          });

          if (result.stderr) {
            const buf = Buffer.from(result.stderr);
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }

          this.finish(result);

          if (globalShellSettings.errexit) {
            throw error;
          }

          return result;
        }
      }
    }
  }

  async _runPipeline(commands) {
    trace('ProcessRunner', () => `_runPipeline ENTER | ${JSON.stringify({
      commandsCount: commands.length
    }, null, 2)}`);

    if (commands.length === 0) {
      trace('ProcessRunner', () => `BRANCH: _runPipeline => NO_COMMANDS | ${JSON.stringify({}, null, 2)}`);
      return createResult({ code: 1, stdout: '', stderr: 'No commands in pipeline', stdin: '' });
    }


    // For true streaming, we need to connect processes via pipes
    if (isBun) {
      trace('ProcessRunner', () => `BRANCH: _runPipeline => BUN_STREAMING | ${JSON.stringify({}, null, 2)}`);
      return this._runStreamingPipelineBun(commands);
    }

    // For Node.js, fall back to non-streaming implementation for now
    trace('ProcessRunner', () => `BRANCH: _runPipeline => NODE_NON_STREAMING | ${JSON.stringify({}, null, 2)}`);
    return this._runPipelineNonStreaming(commands);
  }

  // Run programmatic pipeline (.pipe() method)
  async _runProgrammaticPipeline(source, destination) {
    trace('ProcessRunner', () => `_runProgrammaticPipeline ENTER | ${JSON.stringify({}, null, 2)}`);

    try {
      trace('ProcessRunner', () => 'Executing source command');
      const sourceResult = await source;

      if (sourceResult.code !== 0) {
        trace('ProcessRunner', () => `BRANCH: _runProgrammaticPipeline => SOURCE_FAILED | ${JSON.stringify({
          code: sourceResult.code,
          stderr: sourceResult.stderr
        }, null, 2)}`);
        return sourceResult;
      }

      const destWithStdin = new ProcessRunner(destination.spec, {
        ...destination.options,
        stdin: sourceResult.stdout
      });

      const destResult = await destWithStdin;

      // Debug: Log what destResult looks like
      trace('ProcessRunner', () => `destResult debug | ${JSON.stringify({
        code: destResult.code,
        codeType: typeof destResult.code,
        hasCode: 'code' in destResult,
        keys: Object.keys(destResult),
        resultType: typeof destResult,
        fullResult: JSON.stringify(destResult, null, 2).slice(0, 200)
      }, null, 2)}`);

      return createResult({
        code: destResult.code,
        stdout: destResult.stdout,
        stderr: sourceResult.stderr + destResult.stderr,
        stdin: sourceResult.stdin
      });

    } catch (error) {
      const result = createResult({
        code: error.code ?? 1,
        stdout: '',
        stderr: error.message || 'Pipeline execution failed',
        stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin :
          this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
      });

      const buf = Buffer.from(result.stderr);
      if (this.options.mirror) {
        safeWrite(process.stderr, buf);
      }
      this._emitProcessedData('stderr', buf);

      this.finish(result);

      return result;
    }
  }

  async _runSequence(sequence) {
    trace('ProcessRunner', () => `_runSequence ENTER | ${JSON.stringify({
      commandCount: sequence.commands.length,
      operators: sequence.operators
    }, null, 2)}`);

    let lastResult = { code: 0, stdout: '', stderr: '' };
    let combinedStdout = '';
    let combinedStderr = '';
    
    for (let i = 0; i < sequence.commands.length; i++) {
      const command = sequence.commands[i];
      const operator = i > 0 ? sequence.operators[i - 1] : null;
      
      trace('ProcessRunner', () => `Executing command ${i} | ${JSON.stringify({
        command: command.type,
        operator,
        lastCode: lastResult.code
      }, null, 2)}`);
      
      // Check operator conditions
      if (operator === '&&' && lastResult.code !== 0) {
        trace('ProcessRunner', () => `Skipping due to && with exit code ${lastResult.code}`);
        continue;
      }
      if (operator === '||' && lastResult.code === 0) {
        trace('ProcessRunner', () => `Skipping due to || with exit code ${lastResult.code}`);
        continue;
      }
      
      // Execute command based on type
      if (command.type === 'subshell') {
        lastResult = await this._runSubshell(command);
      } else if (command.type === 'pipeline') {
        lastResult = await this._runPipeline(command.commands);
      } else if (command.type === 'sequence') {
        lastResult = await this._runSequence(command);
      } else if (command.type === 'simple') {
        lastResult = await this._runSimpleCommand(command);
      }
      
      // Accumulate output
      combinedStdout += lastResult.stdout;
      combinedStderr += lastResult.stderr;
    }
    
    return {
      code: lastResult.code,
      stdout: combinedStdout,
      stderr: combinedStderr,
      async text() {
        return combinedStdout;
      }
    };
  }

  async _runSubshell(subshell) {
    trace('ProcessRunner', () => `_runSubshell ENTER | ${JSON.stringify({
      commandType: subshell.command.type
    }, null, 2)}`);
    
    // Save current directory
    const savedCwd = process.cwd();
    
    try {
      // Execute subshell command
      let result;
      if (subshell.command.type === 'sequence') {
        result = await this._runSequence(subshell.command);
      } else if (subshell.command.type === 'pipeline') {
        result = await this._runPipeline(subshell.command.commands);
      } else if (subshell.command.type === 'simple') {
        result = await this._runSimpleCommand(subshell.command);
      } else {
        result = { code: 0, stdout: '', stderr: '' };
      }
      
      return result;
    } finally {
      // Restore directory - check if it still exists first
      trace('ProcessRunner', () => `Restoring cwd from ${process.cwd()} to ${savedCwd}`);
      const fs = await import('fs');
      if (fs.existsSync(savedCwd)) {
        process.chdir(savedCwd);
      } else {
        // If the saved directory was deleted, try to go to a safe location
        const fallbackDir = process.env.HOME || process.env.USERPROFILE || '/';
        trace('ProcessRunner', () => `Saved directory ${savedCwd} no longer exists, falling back to ${fallbackDir}`);
        try {
          process.chdir(fallbackDir);
        } catch (e) {
          // If even fallback fails, just stay where we are
          trace('ProcessRunner', () => `Failed to restore directory: ${e.message}`);
        }
      }
    }
  }

  async _runSimpleCommand(command) {
    trace('ProcessRunner', () => `_runSimpleCommand ENTER | ${JSON.stringify({
      cmd: command.cmd,
      argsCount: command.args?.length || 0,
      hasRedirects: !!command.redirects
    }, null, 2)}`);
    
    const { cmd, args, redirects } = command;
    
    // Check for virtual command
    if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
      trace('ProcessRunner', () => `Using virtual command: ${cmd}`);
      const argValues = args.map(a => a.value || a);
      const result = await this._runVirtual(cmd, argValues);
      
      // Handle output redirection for virtual commands
      if (redirects && redirects.length > 0) {
        for (const redirect of redirects) {
          if (redirect.type === '>' || redirect.type === '>>') {
            const fs = await import('fs');
            if (redirect.type === '>') {
              fs.writeFileSync(redirect.target, result.stdout);
            } else {
              fs.appendFileSync(redirect.target, result.stdout);
            }
            // Clear stdout since it was redirected
            result.stdout = '';
          }
        }
      }
      
      return result;
    }
    
    // Build command string for real execution
    let commandStr = cmd;
    for (const arg of args) {
      if (arg.quoted && arg.quoteChar) {
        commandStr += ` ${arg.quoteChar}${arg.value}${arg.quoteChar}`;
      } else if (arg.value !== undefined) {
        commandStr += ` ${arg.value}`;
      } else {
        commandStr += ` ${arg}`;
      }
    }
    
    // Add redirections
    if (redirects) {
      for (const redirect of redirects) {
        commandStr += ` ${redirect.type} ${redirect.target}`;
      }
    }
    
    trace('ProcessRunner', () => `Executing real command: ${commandStr}`);
    
    // Create a new ProcessRunner for the real command
    // Use current working directory since cd virtual command may have changed it
    const runner = new ProcessRunner(
      { mode: 'shell', command: commandStr },
      { ...this.options, cwd: process.cwd(), _bypassVirtual: true }
    );
    
    return await runner;
  }

  async* stream() {
    trace('ProcessRunner', () => `stream ENTER | ${JSON.stringify({
      started: this.started,
      finished: this.finished,
      command: this.spec?.command?.slice(0, 100)
    }, null, 2)}`);

    // Mark that we're in streaming mode to bypass shell operator interception
    this._isStreaming = true;

    if (!this.started) {
      trace('ProcessRunner', () => 'Auto-starting async process from stream() with streaming mode');
      this._startAsync(); // Start but don't await
    }

    let buffer = [];
    let resolve, reject;
    let ended = false;
    let cleanedUp = false;
    let killed = false;

    const onData = (chunk) => {
      // Don't buffer more data if we're being killed
      if (!killed) {
        buffer.push(chunk);
        if (resolve) {
          resolve();
          resolve = reject = null;
        }
      }
    };

    const onEnd = () => {
      ended = true;
      if (resolve) {
        resolve();
        resolve = reject = null;
      }
    };

    this.on('data', onData);
    this.on('end', onEnd);

    try {
      while (!ended || buffer.length > 0) {
        // Check if we've been killed and should stop immediately
        if (killed) {
          trace('ProcessRunner', () => 'Stream killed, stopping iteration');
          break;
        }
        if (buffer.length > 0) {
          const chunk = buffer.shift();
          // Set a flag that we're about to yield - if the consumer breaks,
          // we'll know not to process any more data
          this._streamYielding = true;
          yield chunk;
          this._streamYielding = false;
        } else if (!ended) {
          await new Promise((res, rej) => {
            resolve = res;
            reject = rej;
          });
        }
      }
    } finally {
      cleanedUp = true;
      this.off('data', onData);
      this.off('end', onEnd);

      // This happens when breaking from a for-await loop
      if (!this.finished) {
        killed = true;
        buffer = []; // Clear any buffered data
        this._streamBreaking = true; // Signal that stream is breaking
        this.kill();
      }
    }
  }

  kill(signal = 'SIGTERM') {
    trace('ProcessRunner', () => `kill ENTER | ${JSON.stringify({
      signal,
      cancelled: this._cancelled,
      finished: this.finished,
      hasChild: !!this.child,
      hasVirtualGenerator: !!this._virtualGenerator,
      command: this.spec?.command?.slice(0, 50) || 'unknown'
    }, null, 2)}`);

    if (this.finished) {
      trace('ProcessRunner', () => 'Already finished, skipping kill');
      return;
    }

    // Mark as cancelled for virtual commands and store the signal
    trace('ProcessRunner', () => `Marking as cancelled | ${JSON.stringify({
      signal,
      previouslyCancelled: this._cancelled,
      previousSignal: this._cancellationSignal
    }, null, 2)}`);
    this._cancelled = true;
    this._cancellationSignal = signal;

    // If this is a pipeline runner, also kill the source and destination
    if (this.spec?.mode === 'pipeline') {
      trace('ProcessRunner', () => 'Killing pipeline components');
      if (this.spec.source && typeof this.spec.source.kill === 'function') {
        this.spec.source.kill(signal);
      }
      if (this.spec.destination && typeof this.spec.destination.kill === 'function') {
        this.spec.destination.kill(signal);
      }
    }

    if (this._cancelResolve) {
      trace('ProcessRunner', () => 'Resolving cancel promise');
      this._cancelResolve();
      trace('ProcessRunner', () => 'Cancel promise resolved');
    } else {
      trace('ProcessRunner', () => 'No cancel promise to resolve');
    }

    // Abort any async operations
    if (this._abortController) {
      trace('ProcessRunner', () => `Aborting internal controller | ${JSON.stringify({
        wasAborted: this._abortController?.signal?.aborted
      }, null, 2)}`);
      this._abortController.abort();
      trace('ProcessRunner', () => `Internal controller aborted | ${JSON.stringify({
        nowAborted: this._abortController?.signal?.aborted
      }, null, 2)}`);
    } else {
      trace('ProcessRunner', () => 'No abort controller to abort');
    }

    // If it's a virtual generator, try to close it
    if (this._virtualGenerator) {
      trace('ProcessRunner', () => `Virtual generator found for cleanup | ${JSON.stringify({
        hasReturn: typeof this._virtualGenerator.return === 'function',
        hasThrow: typeof this._virtualGenerator.throw === 'function',
        cancelled: this._cancelled,
        signal
      }, null, 2)}`);
      
      if (this._virtualGenerator.return) {
        trace('ProcessRunner', () => 'Closing virtual generator with return()');
        try {
          this._virtualGenerator.return();
          trace('ProcessRunner', () => 'Virtual generator closed successfully');
        } catch (err) {
          trace('ProcessRunner', () => `Error closing generator | ${JSON.stringify({ 
            error: err.message,
            stack: err.stack?.slice(0, 200)
          }, null, 2)}`);
        }
      } else {
        trace('ProcessRunner', () => 'Virtual generator has no return() method');
      }
    } else {
      trace('ProcessRunner', () => `No virtual generator to cleanup | ${JSON.stringify({
        hasVirtualGenerator: !!this._virtualGenerator
      }, null, 2)}`);
    }

    // Kill child process if it exists
    if (this.child && !this.finished) {
      trace('ProcessRunner', () => `BRANCH: hasChild => killing | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`);
      try {
        if (this.child.pid) {
          if (isBun) {
            trace('ProcessRunner', () => `Killing Bun process | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`);
            
            // For Bun, use the same enhanced kill logic as Node.js for CI reliability
            const killOperations = [];
            
            // Try SIGTERM first
            try {
              process.kill(this.child.pid, 'SIGTERM');
              trace('ProcessRunner', () => `Sent SIGTERM to Bun process ${this.child.pid}`);
              killOperations.push('SIGTERM to process');
            } catch (err) {
              trace('ProcessRunner', () => `Error sending SIGTERM to Bun process: ${err.message}`);
            }
            
            // Try process group SIGTERM
            try {
              process.kill(-this.child.pid, 'SIGTERM');
              trace('ProcessRunner', () => `Sent SIGTERM to Bun process group -${this.child.pid}`);
              killOperations.push('SIGTERM to group');
            } catch (err) {
              trace('ProcessRunner', () => `Bun process group SIGTERM failed: ${err.message}`);
            }
            
            // Immediately follow with SIGKILL for both process and group
            try {
              process.kill(this.child.pid, 'SIGKILL');
              trace('ProcessRunner', () => `Sent SIGKILL to Bun process ${this.child.pid}`);
              killOperations.push('SIGKILL to process');
            } catch (err) {
              trace('ProcessRunner', () => `Error sending SIGKILL to Bun process: ${err.message}`);
            }
            
            try {
              process.kill(-this.child.pid, 'SIGKILL');
              trace('ProcessRunner', () => `Sent SIGKILL to Bun process group -${this.child.pid}`);
              killOperations.push('SIGKILL to group');
            } catch (err) {
              trace('ProcessRunner', () => `Bun process group SIGKILL failed: ${err.message}`);
            }
            
            trace('ProcessRunner', () => `Bun kill operations attempted: ${killOperations.join(', ')}`);
            
            // Also call the original Bun kill method as backup
            try {
              this.child.kill();
              trace('ProcessRunner', () => `Called child.kill() for Bun process ${this.child.pid}`);
            } catch (err) {
              trace('ProcessRunner', () => `Error calling child.kill(): ${err.message}`);
            }
            
            // Force cleanup of child reference
            if (this.child) {
              this.child.removeAllListeners?.();
              this.child = null;
            }
          } else {
            // In Node.js, use a more robust approach for CI environments
            trace('ProcessRunner', () => `Killing Node process | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`);
            
            // Use immediate and aggressive termination for CI environments
            const killOperations = [];
            
            // Try SIGTERM to the process directly
            try {
              process.kill(this.child.pid, 'SIGTERM');
              trace('ProcessRunner', () => `Sent SIGTERM to process ${this.child.pid}`);
              killOperations.push('SIGTERM to process');
            } catch (err) {
              trace('ProcessRunner', () => `Error sending SIGTERM to process: ${err.message}`);
            }
            
            // Try process group if detached (negative PID)
            try {
              process.kill(-this.child.pid, 'SIGTERM');
              trace('ProcessRunner', () => `Sent SIGTERM to process group -${this.child.pid}`);
              killOperations.push('SIGTERM to group');
            } catch (err) {
              trace('ProcessRunner', () => `Process group SIGTERM failed: ${err.message}`);
            }
            
            // Immediately follow up with SIGKILL for CI reliability
            try {
              process.kill(this.child.pid, 'SIGKILL');
              trace('ProcessRunner', () => `Sent SIGKILL to process ${this.child.pid}`);
              killOperations.push('SIGKILL to process');
            } catch (err) {
              trace('ProcessRunner', () => `Error sending SIGKILL to process: ${err.message}`);
            }
            
            try {
              process.kill(-this.child.pid, 'SIGKILL');
              trace('ProcessRunner', () => `Sent SIGKILL to process group -${this.child.pid}`);
              killOperations.push('SIGKILL to group');
            } catch (err) {
              trace('ProcessRunner', () => `Process group SIGKILL failed: ${err.message}`);
            }
            
            trace('ProcessRunner', () => `Kill operations attempted: ${killOperations.join(', ')}`);
            
            // Force cleanup of child reference to prevent hanging awaits
            if (this.child) {
              this.child.removeAllListeners?.();
              this.child = null;
            }
          }
        }
        // finished will be set by the main cleanup below
      } catch (err) {
        // Process might already be dead
        trace('ProcessRunner', () => `Error killing process | ${JSON.stringify({ error: err.message }, null, 2)}`);
        console.error('Error killing process:', err.message);
      }
    }

    // Mark as finished and emit completion events
    const result = createResult({ 
      code: signal === 'SIGKILL' ? 137 : signal === 'SIGTERM' ? 143 : 130, 
      stdout: '', 
      stderr: `Process killed with ${signal}`, 
      stdin: '' 
    });
    this.finish(result);

    trace('ProcessRunner', () => `kill EXIT | ${JSON.stringify({
      cancelled: this._cancelled,
      finished: this.finished
    }, null, 2)}`);
  }

  pipe(destination) {
    trace('ProcessRunner', () => `pipe ENTER | ${JSON.stringify({
      hasDestination: !!destination,
      destinationType: destination?.constructor?.name
    }, null, 2)}`);

    if (destination instanceof ProcessRunner) {
      trace('ProcessRunner', () => `BRANCH: pipe => PROCESS_RUNNER_DEST | ${JSON.stringify({}, null, 2)}`);
      const pipeSpec = {
        mode: 'pipeline',
        source: this,
        destination: destination
      };

      const pipeRunner = new ProcessRunner(pipeSpec, {
        ...this.options,
        capture: destination.options.capture ?? true
      });

      trace('ProcessRunner', () => `pipe EXIT | ${JSON.stringify({ mode: 'pipeline' }, null, 2)}`);
      return pipeRunner;
    }

    // If destination is a template literal result (from $`command`), use its spec
    if (destination && destination.spec) {
      trace('ProcessRunner', () => `BRANCH: pipe => TEMPLATE_LITERAL_DEST | ${JSON.stringify({}, null, 2)}`);
      const destRunner = new ProcessRunner(destination.spec, destination.options);
      return this.pipe(destRunner);
    }

    trace('ProcessRunner', () => `BRANCH: pipe => INVALID_DEST | ${JSON.stringify({}, null, 2)}`);
    throw new Error('pipe() destination must be a ProcessRunner or $`command` result');
  }

  quiet() {
    trace('ProcessRunner', () => `quiet() called - disabling console output`);
    this.options.mirror = false;
    return this;
  }

  // Promise interface (for await)
  then(onFulfilled, onRejected) {
    trace('ProcessRunner', () => `then() called | ${JSON.stringify({
      hasPromise: !!this.promise,
      started: this.started,
      finished: this.finished
    }, null, 2)}`);
    
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    trace('ProcessRunner', () => `catch() called | ${JSON.stringify({
      hasPromise: !!this.promise,
      started: this.started,
      finished: this.finished
    }, null, 2)}`);
    
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.catch(onRejected);
  }

  finally(onFinally) {
    trace('ProcessRunner', () => `finally() called | ${JSON.stringify({
      hasPromise: !!this.promise,
      started: this.started,
      finished: this.finished
    }, null, 2)}`);
    
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.finally(() => {
      // Ensure cleanup happened
      if (!this.finished) {
        trace('ProcessRunner', () => 'Finally handler ensuring cleanup');
        const fallbackResult = createResult({ 
          code: 1, 
          stdout: '', 
          stderr: 'Process terminated unexpectedly', 
          stdin: '' 
        });
        this.finish(fallbackResult);
      }
      if (onFinally) onFinally();
    });
  }

  // Internal sync execution
  _startSync() {
    trace('ProcessRunner', () => `_startSync ENTER | ${JSON.stringify({
      started: this.started,
      spec: this.spec
    }, null, 2)}`);

    if (this.started) {
      trace('ProcessRunner', () => `BRANCH: _startSync => ALREADY_STARTED | ${JSON.stringify({}, null, 2)}`);
      throw new Error('Command already started - cannot run sync after async start');
    }

    this.started = true;
    this._mode = 'sync';
    trace('ProcessRunner', () => `Starting sync execution | ${JSON.stringify({ mode: this._mode }, null, 2)}`);

    const { cwd, env, stdin } = this.options;
    const shell = findAvailableShell();
    const argv = this.spec.mode === 'shell' ? [shell.cmd, ...shell.args, this.spec.command] : [this.spec.file, ...this.spec.args];

    if (globalShellSettings.xtrace) {
      const traceCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
    }

    if (globalShellSettings.verbose) {
      const verboseCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
    }

    let result;

    if (isBun) {
      // Use Bun's synchronous spawn
      const proc = Bun.spawnSync(argv, {
        cwd,
        env,
        stdin: typeof stdin === 'string' ? Buffer.from(stdin) :
          Buffer.isBuffer(stdin) ? stdin :
            stdin === 'ignore' ? undefined : undefined,
        stdout: 'pipe',
        stderr: 'pipe'
      });

      result = createResult({
        code: proc.exitCode || 0,
        stdout: proc.stdout?.toString('utf8') || '',
        stderr: proc.stderr?.toString('utf8') || '',
        stdin: typeof stdin === 'string' ? stdin :
          Buffer.isBuffer(stdin) ? stdin.toString('utf8') : ''
      });
      result.child = proc;
    } else {
      // Use Node's synchronous spawn
      const proc = cp.spawnSync(argv[0], argv.slice(1), {
        cwd,
        env,
        input: typeof stdin === 'string' ? stdin :
          Buffer.isBuffer(stdin) ? stdin : undefined,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      result = createResult({
        code: proc.status || 0,
        stdout: proc.stdout || '',
        stderr: proc.stderr || '',
        stdin: typeof stdin === 'string' ? stdin :
          Buffer.isBuffer(stdin) ? stdin.toString('utf8') : ''
      });
      result.child = proc;
    }

    // Mirror output if requested (but always capture for result)
    if (this.options.mirror) {
      if (result.stdout) safeWrite(process.stdout, result.stdout);
      if (result.stderr) safeWrite(process.stderr, result.stderr);
    }

    // Store chunks for events (batched after completion)
    this.outChunks = result.stdout ? [Buffer.from(result.stdout)] : [];
    this.errChunks = result.stderr ? [Buffer.from(result.stderr)] : [];

    // Emit batched events after completion
    if (result.stdout) {
      const stdoutBuf = Buffer.from(result.stdout);
      this._emitProcessedData('stdout', stdoutBuf);
    }

    if (result.stderr) {
      const stderrBuf = Buffer.from(result.stderr);
      this._emitProcessedData('stderr', stderrBuf);
    }

    this.finish(result);

    if (globalShellSettings.errexit && result.code !== 0) {
      const error = new Error(`Command failed with exit code ${result.code}`);
      error.code = result.code;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      error.result = result;
      throw error;
    }

    return result;
  }

}

// Public APIs
async function sh(commandString, options = {}) {
  trace('API', () => `sh ENTER | ${JSON.stringify({
    command: commandString,
    options
  }, null, 2)}`);

  const runner = new ProcessRunner({ mode: 'shell', command: commandString }, options);
  const result = await runner._startAsync();

  trace('API', () => `sh EXIT | ${JSON.stringify({ code: result.code }, null, 2)}`);
  return result;
}

async function exec(file, args = [], options = {}) {
  trace('API', () => `exec ENTER | ${JSON.stringify({
    file,
    argsCount: args.length,
    options
  }, null, 2)}`);

  const runner = new ProcessRunner({ mode: 'exec', file, args }, options);
  const result = await runner._startAsync();

  trace('API', () => `exec EXIT | ${JSON.stringify({ code: result.code }, null, 2)}`);
  return result;
}

async function run(commandOrTokens, options = {}) {
  trace('API', () => `run ENTER | ${JSON.stringify({
    type: typeof commandOrTokens,
    options
  }, null, 2)}`);

  if (typeof commandOrTokens === 'string') {
    trace('API', () => `BRANCH: run => STRING_COMMAND | ${JSON.stringify({ command: commandOrTokens }, null, 2)}`);
    return sh(commandOrTokens, { ...options, mirror: false, capture: true });
  }

  const [file, ...args] = commandOrTokens;
  trace('API', () => `BRANCH: run => TOKEN_ARRAY | ${JSON.stringify({ file, argsCount: args.length }, null, 2)}`);
  return exec(file, args, { ...options, mirror: false, capture: true });
}

function $tagged(strings, ...values) {
  // Check if called as a function with options object: $({ options })
  if (!Array.isArray(strings) && typeof strings === 'object' && strings !== null) {
    const options = strings;
    trace('API', () => `$tagged called with options | ${JSON.stringify({ options }, null, 2)}`);
    
    // Return a new tagged template function with those options
    return (innerStrings, ...innerValues) => {
      trace('API', () => `$tagged.withOptions ENTER | ${JSON.stringify({
        stringsLength: innerStrings.length,
        valuesLength: innerValues.length,
        options
      }, null, 2)}`);
      
      const cmd = buildShellCommand(innerStrings, innerValues);
      const runner = new ProcessRunner({ mode: 'shell', command: cmd }, { mirror: true, capture: true, ...options });
      
      trace('API', () => `$tagged.withOptions EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`);
      return runner;
    };
  }
  
  // Normal tagged template literal usage
  trace('API', () => `$tagged ENTER | ${JSON.stringify({
    stringsLength: strings.length,
    valuesLength: values.length
  }, null, 2)}`);

  const cmd = buildShellCommand(strings, values);
  const runner = new ProcessRunner({ mode: 'shell', command: cmd }, { mirror: true, capture: true });

  trace('API', () => `$tagged EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`);
  return runner;
}

function create(defaultOptions = {}) {
  trace('API', () => `create ENTER | ${JSON.stringify({ defaultOptions }, null, 2)}`);

  const tagged = (strings, ...values) => {
    trace('API', () => `create.tagged ENTER | ${JSON.stringify({
      stringsLength: strings.length,
      valuesLength: values.length
    }, null, 2)}`);

    const cmd = buildShellCommand(strings, values);
    const runner = new ProcessRunner({ mode: 'shell', command: cmd }, { mirror: true, capture: true, ...defaultOptions });

    trace('API', () => `create.tagged EXIT | ${JSON.stringify({ command: cmd }, null, 2)}`);
    return runner;
  };

  trace('API', () => `create EXIT | ${JSON.stringify({}, null, 2)}`);
  return tagged;
}

function raw(value) {
  trace('API', () => `raw() called with value: ${String(value).slice(0, 50)}`);
  return { raw: String(value) };
}

function set(option) {
  trace('API', () => `set() called with option: ${option}`);
  const mapping = {
    'e': 'errexit',     // set -e: exit on error
    'errexit': 'errexit',
    'v': 'verbose',     // set -v: verbose
    'verbose': 'verbose',
    'x': 'xtrace',      // set -x: trace execution
    'xtrace': 'xtrace',
    'u': 'nounset',     // set -u: error on unset vars
    'nounset': 'nounset',
    'o pipefail': 'pipefail',  // set -o pipefail
    'pipefail': 'pipefail'
  };

  if (mapping[option]) {
    globalShellSettings[mapping[option]] = true;
    if (globalShellSettings.verbose) {
      console.log(`+ set -${option}`);
    }
  }
  return globalShellSettings;
}

function unset(option) {
  trace('API', () => `unset() called with option: ${option}`);
  const mapping = {
    'e': 'errexit',
    'errexit': 'errexit',
    'v': 'verbose',
    'verbose': 'verbose',
    'x': 'xtrace',
    'xtrace': 'xtrace',
    'u': 'nounset',
    'nounset': 'nounset',
    'o pipefail': 'pipefail',
    'pipefail': 'pipefail'
  };

  if (mapping[option]) {
    globalShellSettings[mapping[option]] = false;
    if (globalShellSettings.verbose) {
      console.log(`+ set +${option}`);
    }
  }
  return globalShellSettings;
}

// Convenience functions for common patterns
const shell = {
  set,
  unset,
  settings: () => ({ ...globalShellSettings }),

  // Bash-like shortcuts
  errexit: (enable = true) => enable ? set('e') : unset('e'),
  verbose: (enable = true) => enable ? set('v') : unset('v'),
  xtrace: (enable = true) => enable ? set('x') : unset('x'),
  pipefail: (enable = true) => enable ? set('o pipefail') : unset('o pipefail'),
  nounset: (enable = true) => enable ? set('u') : unset('u'),
};

// Virtual command registration API
function register(name, handler) {
  trace('VirtualCommands', () => `register ENTER | ${JSON.stringify({ name }, null, 2)}`);
  virtualCommands.set(name, handler);
  trace('VirtualCommands', () => `register EXIT | ${JSON.stringify({ registered: true }, null, 2)}`);
  return virtualCommands;
}

function unregister(name) {
  trace('VirtualCommands', () => `unregister ENTER | ${JSON.stringify({ name }, null, 2)}`);
  const deleted = virtualCommands.delete(name);
  trace('VirtualCommands', () => `unregister EXIT | ${JSON.stringify({ deleted }, null, 2)}`);
  return deleted;
}

function listCommands() {
  const commands = Array.from(virtualCommands.keys());
  trace('VirtualCommands', () => `listCommands() returning ${commands.length} commands`);
  return commands;
}

function enableVirtualCommands() {
  trace('VirtualCommands', () => 'Enabling virtual commands');
  virtualCommandsEnabled = true;
  return virtualCommandsEnabled;
}

function disableVirtualCommands() {
  trace('VirtualCommands', () => 'Disabling virtual commands');
  virtualCommandsEnabled = false;
  return virtualCommandsEnabled;
}

// Import virtual commands
import cdCommand from './commands/$.cd.mjs';
import pwdCommand from './commands/$.pwd.mjs';
import echoCommand from './commands/$.echo.mjs';
import sleepCommand from './commands/$.sleep.mjs';
import trueCommand from './commands/$.true.mjs';
import falseCommand from './commands/$.false.mjs';
import createWhichCommand from './commands/$.which.mjs';
import createExitCommand from './commands/$.exit.mjs';
import envCommand from './commands/$.env.mjs';
import catCommand from './commands/$.cat.mjs';
import lsCommand from './commands/$.ls.mjs';
import mkdirCommand from './commands/$.mkdir.mjs';
import rmCommand from './commands/$.rm.mjs';
import mvCommand from './commands/$.mv.mjs';
import cpCommand from './commands/$.cp.mjs';
import touchCommand from './commands/$.touch.mjs';
import basenameCommand from './commands/$.basename.mjs';
import dirnameCommand from './commands/$.dirname.mjs';
import yesCommand from './commands/$.yes.mjs';
import seqCommand from './commands/$.seq.mjs';
import testCommand from './commands/$.test.mjs';

// Built-in commands that match Bun.$ functionality
function registerBuiltins() {
  trace('VirtualCommands', () => 'registerBuiltins() called - registering all built-in commands');
  // Register all imported commands
  register('cd', cdCommand);
  register('pwd', pwdCommand);
  register('echo', echoCommand);
  register('sleep', sleepCommand);
  register('true', trueCommand);
  register('false', falseCommand);
  register('which', createWhichCommand(virtualCommands));
  register('exit', createExitCommand(globalShellSettings));
  register('env', envCommand);
  register('cat', catCommand);
  register('ls', lsCommand);
  register('mkdir', mkdirCommand);
  register('rm', rmCommand);
  register('mv', mvCommand);
  register('cp', cpCommand);
  register('touch', touchCommand);
  register('basename', basenameCommand);
  register('dirname', dirnameCommand);
  register('yes', yesCommand);
  register('seq', seqCommand);
  register('test', testCommand);
}


// ANSI control character utilities
const AnsiUtils = {
  stripAnsi(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\x1b\[[0-9;]*[mGKHFJ]/g, '');
  },

  stripControlChars(text) {
    if (typeof text !== 'string') return text;
    // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  },

  stripAll(text) {
    if (typeof text !== 'string') return text;
    // Preserve newlines (\n = \x0A), carriage returns (\r = \x0D), and tabs (\t = \x09)
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x1b\[[0-9;]*[mGKHFJ]/g, '');
  },

  cleanForProcessing(data) {
    if (Buffer.isBuffer(data)) {
      return Buffer.from(this.stripAll(data.toString('utf8')));
    }
    return this.stripAll(data);
  }
};

let globalAnsiConfig = {
  preserveAnsi: true,
  preserveControlChars: true
};

function configureAnsi(options = {}) {
  trace('AnsiUtils', () => `configureAnsi() called | ${JSON.stringify({ options }, null, 2)}`);
  globalAnsiConfig = { ...globalAnsiConfig, ...options };
  trace('AnsiUtils', () => `New ANSI config | ${JSON.stringify({ globalAnsiConfig }, null, 2)}`);
  return globalAnsiConfig;
}

function getAnsiConfig() {
  trace('AnsiUtils', () => `getAnsiConfig() returning | ${JSON.stringify({ globalAnsiConfig }, null, 2)}`);
  return { ...globalAnsiConfig };
}

function processOutput(data, options = {}) {
  trace('AnsiUtils', () => `processOutput() called | ${JSON.stringify({ 
    dataType: typeof data,
    dataLength: Buffer.isBuffer(data) ? data.length : data?.length,
    options 
  }, null, 2)}`);
  const config = { ...globalAnsiConfig, ...options };
  if (!config.preserveAnsi && !config.preserveControlChars) {
    return AnsiUtils.cleanForProcessing(data);
  } else if (!config.preserveAnsi) {
    return Buffer.isBuffer(data)
      ? Buffer.from(AnsiUtils.stripAnsi(data.toString('utf8')))
      : AnsiUtils.stripAnsi(data);
  } else if (!config.preserveControlChars) {
    return Buffer.isBuffer(data)
      ? Buffer.from(AnsiUtils.stripControlChars(data.toString('utf8')))
      : AnsiUtils.stripControlChars(data);
  }
  return data;
}

// Initialize built-in commands
trace('Initialization', () => 'Registering built-in virtual commands');
registerBuiltins();
trace('Initialization', () => `Built-in commands registered: ${listCommands().join(', ')}`);

export {
  $tagged as $,
  sh,
  exec,
  run,
  quote,
  create,
  raw,
  ProcessRunner,
  shell,
  set,
  resetGlobalState,
  unset,
  register,
  unregister,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput,
  forceCleanupAll
};
export default $tagged;