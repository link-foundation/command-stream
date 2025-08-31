// Enhanced $ shell utilities with streaming, async iteration, and EventEmitter support
// Usage patterns:
// 1. Classic await: const result = await $`command`
// 2. Async iteration: for await (const chunk of $`command`.stream()) { ... }
// 3. EventEmitter: $`command`.on('data', chunk => ...).on('end', result => ...)
// 4. Stream access: $`command`.stdout, $`command`.stderr

import { createRequire } from 'module';
import cp from 'child_process';
import fs from 'fs';
import path from 'path';

const isBun = typeof globalThis.Bun !== 'undefined';

const VERBOSE = process.env.COMMAND_STREAM_VERBOSE === 'true' || process.env.CI === 'true';

// Interactive commands that need TTY forwarding by default
const INTERACTIVE_COMMANDS = new Set([
  'top', 'htop', 'btop', 'less', 'more', 'vi', 'vim', 'nano', 'emacs',
  'man', 'pager', 'watch', 'tmux', 'screen', 'ssh', 'ftp', 'sftp',
  'mysql', 'psql', 'redis-cli', 'mongo', 'sqlite3', 'irb', 'python',
  'node', 'repl', 'gdb', 'lldb', 'bc', 'dc', 'ed'
]);

// Trace function for verbose logging
function trace(category, messageOrFunc) {
  if (!VERBOSE) return;
  const message = typeof messageOrFunc === 'function' ? messageOrFunc() : messageOrFunc;
  const timestamp = new Date().toISOString();
  console.error(`[TRACE ${timestamp}] [${category}] ${message}`);
}

// Check if a command is interactive and needs TTY forwarding
function isInteractiveCommand(command) {
  if (!command || typeof command !== 'string') return false;
  
  // Extract command and arguments from shell command string
  const parts = command.trim().split(/\s+/);
  const commandName = parts[0];
  const baseName = path.basename(commandName);
  
  // Special handling for commands that are only interactive when run without arguments/scripts
  if (baseName === 'node' || baseName === 'python' || baseName === 'python3') {
    // These are only interactive when run without a script file
    // If there are additional arguments (like a script file), they're not interactive
    return parts.length === 1;
  }
  
  return INTERACTIVE_COMMANDS.has(baseName);
}


// Track parent stream state for graceful shutdown
let parentStreamsMonitored = false;
const activeProcessRunners = new Set();

// Track if SIGINT handler has been installed
let sigintHandlerInstalled = false;

function installSignalHandlers() {
  if (sigintHandlerInstalled) return;
  sigintHandlerInstalled = true;
  
  // Forward SIGINT to all active child processes
  // The parent process continues running - it's up to the parent to decide what to do
  const sigintHandler = () => {
    // Count active child processes
    const activeChildren = [];
    for (const runner of activeProcessRunners) {
      if (runner.child && runner.child.pid && !runner.finished) {
        activeChildren.push(runner);
      }
    }
    
    trace('ProcessRunner', () => `Parent received SIGINT - ${activeChildren.length} active child processes`);
    
    // Only handle SIGINT if we have active child processes
    // Otherwise, let the default behavior or user handlers take over
    if (activeChildren.length === 0) {
      trace('ProcessRunner', () => `No active children - allowing default SIGINT behavior`);
      return; // Let default Node.js/Bun SIGINT behavior handle it
    }
    
    // Forward signal to all active child processes
    for (const runner of activeChildren) {
      try {
        trace('ProcessRunner', () => `Sending SIGINT to child process ${runner.child.pid}`);
        if (isBun) {
          runner.child.kill('SIGINT');
        } else {
          // Send to process group if detached, otherwise to process directly
          try {
            process.kill(-runner.child.pid, 'SIGINT');
          } catch (err) {
            process.kill(runner.child.pid, 'SIGINT');
          }
        }
      } catch (err) {
        trace('ProcessRunner', () => `Error sending SIGINT to child: ${err.message}`);
      }
    }
    
    // After forwarding SIGINT to children, wait for them to finish and then exit with proper signal code
    // This mimics proper shell behavior where CTRL+C interrupts the entire process tree
    const waitForChildren = async () => {
      // Collect all active child processes (re-check as they may have finished)
      const childPromises = [];
      for (const runner of activeChildren) {
        if (runner.child && runner.child.pid && !runner.finished) {
          // Wait for each child process to exit
          if (isBun) {
            childPromises.push(runner.child.exited);
          } else {
            childPromises.push(new Promise((resolve) => {
              runner.child.on('close', resolve);
              runner.child.on('exit', resolve);
            }));
          }
        }
      }
      
      if (childPromises.length > 0) {
        // Wait for all children to finish
        try {
          await Promise.all(childPromises);
        } catch (err) {
          // If waiting fails, proceed anyway
        }
      }
      
      process.exit(130); // 128 + 2 (SIGINT)
    };
    
    // Run asynchronously to avoid blocking the signal handler
    waitForChildren().catch(() => process.exit(130));
  };
  
  process.on('SIGINT', sigintHandler);
}

function monitorParentStreams() {
  if (parentStreamsMonitored) return;
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
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);

    // No auto-start - explicit start() or await will start the process

    return this;
  }

  emit(event, ...args) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(...args);
      }
    }
    return this;
  }

  off(event, listener) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
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
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(strings, values) {
  trace('Utils', () => `buildShellCommand ENTER | ${JSON.stringify({
    stringsLength: strings.length,
    valuesLength: values.length
  }, null, 2)}`);

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
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(chunk);
}

async function pumpReadable(readable, onChunk) {
  if (!readable) return;
  for await (const chunk of readable) {
    await onChunk(asBuffer(chunk));
  }
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
    this._virtualGenerator = null;
    this._abortController = new AbortController();

    activeProcessRunners.add(this);
    installSignalHandlers();

    // Track finished state changes to trigger cleanup
    this._finished = false;
  }

  get finished() {
    return this._finished;
  }

  _emitProcessedData(type, buf) {
    const processedBuf = processOutput(buf, this.options.ansi);
    this.emit(type, processedBuf);
    this.emit('data', { type, data: processedBuf });
  }

  async _forwardTTYStdin() {
    if (!process.stdin.isTTY || !this.child.stdin) {
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

  set finished(value) {
    if (value === true && this._finished === false) {
      this._finished = true;
      this._cleanup(); // Trigger cleanup when process finishes
    } else {
      this._finished = value;
    }
  }

  _handleParentStreamClosure() {
    if (this.finished || this._cancelled) return;

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

        setTimeout(() => {
          if (this.child && !this.finished) {
            trace('ProcessRunner', () => 'Terminating child process after parent stream closure');
            if (typeof this.child.kill === 'function') {
              this.child.kill('SIGTERM');
            }
          }
        }, 100);

      } catch (error) {
        trace('ProcessRunner', () => `Error during graceful shutdown | ${JSON.stringify({ error: error.message }, null, 2)}`);
      }
    }

    activeProcessRunners.delete(this);
  }

  _cleanup() {
    activeProcessRunners.delete(this);
  }

  // Unified start method that can work in both async and sync modes
  start(options = {}) {
    const mode = options.mode || 'async';

    trace('ProcessRunner', () => `start ENTER | ${JSON.stringify({ mode, options, started: this.started }, null, 2)}`);

    // Merge new options with existing options before starting
    if (Object.keys(options).length > 0 && !this.started) {
      trace('ProcessRunner', () => `BRANCH: options => MERGE | ${JSON.stringify({ 
        oldOptions: this.options, 
        newOptions: options 
      }, null, 2)}`);

      // Create a new options object merging the current ones with the new ones
      this.options = { ...this.options, ...options };
      
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
        } else if (parsed.type === 'simple' && virtualCommandsEnabled && virtualCommands.has(parsed.cmd)) {
          // For built-in virtual commands that have real counterparts (like sleep),
          // skip the virtual version when custom stdin is provided to ensure proper process handling
          const hasCustomStdin = this.options.stdin && 
                                 this.options.stdin !== 'inherit' && 
                                 this.options.stdin !== 'ignore';
          
          // List of built-in virtual commands that should fallback to real commands with custom stdin
          const builtinCommands = ['sleep', 'echo', 'pwd', 'true', 'false', 'yes', 'cat', 'ls', 'which'];
          const shouldBypassVirtual = hasCustomStdin && builtinCommands.includes(parsed.cmd);
          
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
            return await this._runVirtual(parsed.cmd, parsed.args, this.spec.command);
          }
        }
      }
    }

    const argv = this.spec.mode === 'shell' ? ['sh', '-lc', this.spec.command] : [this.spec.file, ...this.spec.args];

    if (globalShellSettings.xtrace) {
      const traceCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
    }

    if (globalShellSettings.verbose) {
      const verboseCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
    }

    // Detect if this is an interactive command that needs direct TTY access
    // Only activate for interactive commands when we have a real TTY and the command is likely to need it
    const isInteractive = stdin === 'inherit' && 
      process.stdin.isTTY === true && 
      process.stdout.isTTY === true && 
      process.stderr.isTTY === true &&
      (this.spec.mode === 'shell' ? isInteractiveCommand(this.spec.command) : isInteractiveCommand(this.spec.file));

    const spawnBun = (argv) => {
      if (isInteractive) {
        // For interactive commands, use inherit to provide direct TTY access
        return Bun.spawn(argv, { cwd, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      }
      // For non-interactive commands, spawn with detached to create process group (for proper signal handling)
      // This allows us to send signals to the entire process group, killing shell and all its children
      return Bun.spawn(argv, { 
        cwd, 
        env, 
        stdin: 'pipe', 
        stdout: 'pipe', 
        stderr: 'pipe',
        detached: process.platform !== 'win32' // Create process group on Unix-like systems
      });
    };
    const spawnNode = async (argv) => {
      if (isInteractive) {
        // For interactive commands, use inherit to provide direct TTY access
        return cp.spawn(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
      }
      // For non-interactive commands, spawn with detached to create process group (for proper signal handling)
      // This allows us to send signals to the entire process group
      return cp.spawn(argv[0], argv.slice(1), { 
        cwd, 
        env, 
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32' // Create process group on Unix-like systems
      });
    };

    const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
    const preferNodeForInput = isBun && needsExplicitPipe;
    this.child = preferNodeForInput ? await spawnNode(argv) : (isBun ? spawnBun(argv) : await spawnNode(argv));
    
    // Add detailed logging for CI debugging
    if (this.child) {
      trace('ProcessRunner', () => `Child process created | ${JSON.stringify({ 
        pid: this.child.pid, 
        detached: this.child.options?.detached,
        killed: this.child.killed,
        exitCode: this.child.exitCode,
        signalCode: this.child.signalCode
      }, null, 2)}`);
    }

    // For interactive commands with stdio: 'inherit', stdout/stderr will be null
    const outPump = this.child.stdout ? pumpReadable(this.child.stdout, async (buf) => {
      if (this.options.capture) this.outChunks.push(buf);
      if (this.options.mirror) safeWrite(process.stdout, buf);

      // Emit chunk events
      this._emitProcessedData('stdout', buf);
    }) : Promise.resolve();

    const errPump = this.child.stderr ? pumpReadable(this.child.stderr, async (buf) => {
      if (this.options.capture) this.errChunks.push(buf);
      if (this.options.mirror) safeWrite(process.stderr, buf);

      // Emit chunk events
      this._emitProcessedData('stderr', buf);
    }) : Promise.resolve();

    let stdinPumpPromise = Promise.resolve();
    if (stdin === 'inherit') {
      if (isInteractive) {
        // For interactive commands with stdio: 'inherit', stdin is handled automatically
        stdinPumpPromise = Promise.resolve();
      } else {
        const isPipedIn = process.stdin && process.stdin.isTTY === false;
        if (isPipedIn) {
          stdinPumpPromise = this._pumpStdinTo(this.child, this.options.capture ? this.inChunks : null);
        } else {
          // For TTY (interactive terminal), forward stdin directly for non-interactive commands
          stdinPumpPromise = this._forwardTTYStdin();
        }
      }
    } else if (stdin === 'ignore') {
      if (this.child.stdin && typeof this.child.stdin.end === 'function') this.child.stdin.end();
    } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
      const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
      if (this.options.capture && this.inChunks) this.inChunks.push(Buffer.from(buf));
      stdinPumpPromise = this._writeToStdin(buf);
    }

    const exited = isBun ? this.child.exited : new Promise((resolve) => {
      trace('ProcessRunner', () => `Setting up child process event listeners for PID ${this.child.pid}`);
      this.child.on('close', (code, signal) => {
        trace('ProcessRunner', () => `Child process close event | ${JSON.stringify({ pid: this.child.pid, code, signal }, null, 2)}`);
        resolve(code);
      });
      this.child.on('exit', (code, signal) => {
        trace('ProcessRunner', () => `Child process exit event | ${JSON.stringify({ pid: this.child.pid, code, signal }, null, 2)}`);
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

    this.result = {
      ...resultData,
      async text() {
        return resultData.stdout || '';
      }
    };

    this.finished = true;
    this.emit('end', this.result);
    this.emit('exit', this.result.code);

    if (globalShellSettings.errexit && this.result.code !== 0) {
      const error = new Error(`Command failed with exit code ${this.result.code}`);
      error.code = this.result.code;
      error.stdout = this.result.stdout;
      error.stderr = this.result.stderr;
      error.result = this.result;
      throw error;
    }

    return this.result;
  }

  async _pumpStdinTo(child, captureChunks) {
    if (!child.stdin) return;
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
    const trimmed = command.trim();
    if (!trimmed) return null;

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
      if (this.options.stdin && typeof this.options.stdin === 'string') {
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
          ...this.options,
          isCancelled: () => this._cancelled,
          signal: this._abortController.signal
        };

        const generator = handler({ args: argValues, stdin: stdinData, ...commandOptions });
        this._virtualGenerator = generator;

        const cancelPromise = new Promise(resolve => {
          this._cancelResolve = resolve;
        });

        try {
          const iterator = generator[Symbol.asyncIterator]();
          let done = false;

          while (!done && !this._cancelled) {
            const result = await Promise.race([
              iterator.next(),
              cancelPromise.then(() => ({ done: true, cancelled: true }))
            ]);

            if (result.cancelled || this._cancelled) {
              // Cancelled - close the generator
              if (iterator.return) {
                await iterator.return();
              }
              break;
            }

            done = result.done;

            if (!done) {
              const chunk = result.value;
              const buf = Buffer.from(chunk);
              chunks.push(buf);

              // Only output if not cancelled
              if (!this._cancelled) {
                if (this.options.mirror) {
                  safeWrite(process.stdout, buf);
                }

                this._emitProcessedData('stdout', buf);
              }
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
        const handlerPromise = handler({ args: argValues, stdin: stdinData, ...this.options });
        
        // Create an abort promise that rejects when cancelled
        const abortPromise = new Promise((_, reject) => {
          if (this._abortController.signal.aborted) {
            reject(new Error('Command cancelled'));
          }
          this._abortController.signal.addEventListener('abort', () => {
            reject(new Error('Command cancelled'));
          });
        });
        
        try {
          result = await Promise.race([handlerPromise, abortPromise]);
        } catch (err) {
          if (err.message === 'Command cancelled') {
            // Command was cancelled, return SIGTERM exit code
            result = { 
              code: 143, // 128 + 15 (SIGTERM)
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

      // Store result
      this.result = result;
      this.finished = true;

      // Emit completion events
      this.emit('end', result);
      this.emit('exit', result.code);

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
      const result = {
        code: error.code ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        stdin: ''
      };

      this.result = result;
      this.finished = true;

      if (result.stderr) {
        const buf = Buffer.from(result.stderr);
        if (this.options.mirror) {
          safeWrite(process.stderr, buf);
        }
        this._emitProcessedData('stderr', buf);
      }

      this.emit('end', result);
      this.emit('exit', result.code);

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

      const spawnArgs = needsShell
        ? ['sh', '-c', commandStr]
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

    this.result = result;
    this.finished = true;

    this.emit('end', result);
    this.emit('exit', result.code);

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

      const spawnArgs = needsShell
        ? ['sh', '-c', commandStr]
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

    this.result = result;
    this.finished = true;

    this.emit('end', result);
    this.emit('exit', result.code);

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

        const proc = Bun.spawn(['sh', '-c', commandStr], {
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

    this.result = result;
    this.finished = true;

    this.emit('end', result);
    this.emit('exit', result.code);

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

            this.result = finalResult;
            this.finished = true;

            // Emit completion events
            this.emit('end', finalResult);
            this.emit('exit', finalResult.code);

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

          this.result = result;
          this.finished = true;

          if (result.stderr) {
            const buf = Buffer.from(result.stderr);
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }

          this.emit('end', result);
          this.emit('exit', result.code);

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
              const proc = cp.spawn(argv[0], argv.slice(1), {
                cwd: this.options.cwd,
                env: this.options.env,
                stdio: ['pipe', 'pipe', 'pipe']
              });

              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
                // If this is the last command, emit streaming data
                if (isLastCommand) {
                  if (this.options.mirror) {
                    safeWrite(process.stdout, chunk);
                  }
                  this._emitProcessedData('stdout', chunk);
                }
              });

              proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
                // If this is the last command, emit streaming data
                if (isLastCommand) {
                  if (this.options.mirror) {
                    safeWrite(process.stderr, chunk);
                  }
                  this._emitProcessedData('stderr', chunk);
                }
              });

              proc.on('close', (code) => {
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
          const argv = ['sh', '-c', commandStr];
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

            this.result = finalResult;
            this.finished = true;

            // Emit completion events
            this.emit('end', finalResult);
            this.emit('exit', finalResult.code);

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

          this.result = result;
          this.finished = true;

          if (result.stderr) {
            const buf = Buffer.from(result.stderr);
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }
            this._emitProcessedData('stderr', buf);
          }

          this.emit('end', result);
          this.emit('exit', result.code);

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

      this.result = result;
      this.finished = true;

      const buf = Buffer.from(result.stderr);
      if (this.options.mirror) {
        safeWrite(process.stderr, buf);
      }
      this._emitProcessedData('stderr', buf);

      this.emit('end', result);
      this.emit('exit', result.code);

      return result;
    }
  }

  async* stream() {
    trace('ProcessRunner', () => `stream ENTER | ${JSON.stringify({
      started: this.started,
      finished: this.finished
    }, null, 2)}`);

    if (!this.started) {
      trace('ProcessRunner', () => 'Auto-starting async process from stream()');
      this._startAsync(); // Start but don't await
    }

    let buffer = [];
    let resolve, reject;
    let ended = false;
    let cleanedUp = false;

    const onData = (chunk) => {
      buffer.push(chunk);
      if (resolve) {
        resolve();
        resolve = reject = null;
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
        if (buffer.length > 0) {
          yield buffer.shift();
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
        this.kill();
      }
    }
  }

  kill() {
    trace('ProcessRunner', () => `kill ENTER | ${JSON.stringify({
      cancelled: this._cancelled,
      finished: this.finished,
      hasChild: !!this.child,
      hasVirtualGenerator: !!this._virtualGenerator
    }, null, 2)}`);

    // Mark as cancelled for virtual commands
    this._cancelled = true;

    if (this._cancelResolve) {
      trace('ProcessRunner', () => 'Resolving cancel promise');
      this._cancelResolve();
    }

    // Abort any async operations
    if (this._abortController) {
      trace('ProcessRunner', () => 'Aborting controller');
      this._abortController.abort();
    }

    // If it's a virtual generator, try to close it
    if (this._virtualGenerator && this._virtualGenerator.return) {
      trace('ProcessRunner', () => 'Closing virtual generator');
      try {
        this._virtualGenerator.return();
      } catch (err) {
        trace('ProcessRunner', () => `Error closing generator | ${JSON.stringify({ error: err.message }, null, 2)}`);
      }
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
        this.finished = true;
      } catch (err) {
        // Process might already be dead
        trace('ProcessRunner', () => `Error killing process | ${JSON.stringify({ error: err.message }, null, 2)}`);
        console.error('Error killing process:', err.message);
      }
    }

    // Mark as finished
    this.finished = true;

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

  // Promise interface (for await)
  then(onFulfilled, onRejected) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.catch(onRejected);
  }

  finally(onFinally) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.finally(onFinally);
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
    const argv = this.spec.mode === 'shell' ? ['sh', '-lc', this.spec.command] : [this.spec.file, ...this.spec.args];

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

    this.result = result;
    this.finished = true;

    // Emit batched events after completion
    if (result.stdout) {
      const stdoutBuf = Buffer.from(result.stdout);
      this._emitProcessedData('stdout', stdoutBuf);
    }

    if (result.stderr) {
      const stderrBuf = Buffer.from(result.stderr);
      this._emitProcessedData('stderr', stderrBuf);
    }

    this.emit('end', result);
    this.emit('exit', result.code);

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

  // Stream properties
  get stdout() {
    return this.child?.stdout;
  }

  get stderr() {
    return this.child?.stderr;
  }

  get stdin() {
    return this.child?.stdin;
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
  return { raw: String(value) };
}

function set(option) {
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
  return Array.from(virtualCommands.keys());
}

function enableVirtualCommands() {
  virtualCommandsEnabled = true;
  return virtualCommandsEnabled;
}

function disableVirtualCommands() {
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
    return text.replace(/[\x00-\x1F\x7F]/g, '');
  },

  stripAll(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/[\x00-\x1F\x7F]|\x1b\[[0-9;]*[mGKHFJ]/g, '');
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
  globalAnsiConfig = { ...globalAnsiConfig, ...options };
  return globalAnsiConfig;
}

function getAnsiConfig() {
  return { ...globalAnsiConfig };
}

function processOutput(data, options = {}) {
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
registerBuiltins();

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
  unset,
  register,
  unregister,
  listCommands,
  enableVirtualCommands,
  disableVirtualCommands,
  AnsiUtils,
  configureAnsi,
  getAnsiConfig,
  processOutput
};
export default $tagged;