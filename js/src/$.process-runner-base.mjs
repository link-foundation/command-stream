// ProcessRunner base class - core constructor, properties, and lifecycle methods
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import {
  activeProcessRunners,
  virtualCommands,
  installSignalHandlers,
  monitorParentStreams,
  uninstallSignalHandlers,
} from './$.state.mjs';
import { StreamEmitter } from './$.stream-emitter.mjs';
import { processOutput } from './$.ansi.mjs';
import { ensureResultText } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Wait for child stream to become available
 * @param {object} self - ProcessRunner instance
 * @param {string} streamName - Name of stream (stdin, stdout, stderr)
 * @returns {Promise<object|null>}
 */
function waitForChildStream(self, streamName) {
  return new Promise((resolve) => {
    const checkForChild = () => {
      if (self._child && self._child[streamName]) {
        resolve(self._child[streamName]);
      } else if (self.finished || self._virtualGenerator) {
        resolve(null);
      } else {
        setImmediate(checkForChild);
      }
    };
    setImmediate(checkForChild);
  });
}

/** Capture writes made through a public live stdin stream once per child. */
function trackStdinWrites(runner, stream) {
  if (!stream || stream._commandStreamTracksInput) {
    return stream;
  }
  Object.defineProperty(stream, '_commandStreamTracksInput', { value: true });
  const record = (chunk, args) => {
    if (
      chunk !== null &&
      chunk !== undefined &&
      runner.options.capture &&
      runner.inChunks
    ) {
      const encoding = typeof args[0] === 'string' ? args[0] : 'utf8';
      runner.inChunks.push(Buffer.from(chunk, encoding));
    }
  };
  const write = stream.write;
  const trackedWrite = function (chunk, ...args) {
    const written = write.call(this, chunk, ...args);
    record(chunk, args);
    return written;
  };
  const end = stream.end;
  const trackedEnd = function (chunk, ...args) {
    const ended = end.call(this, chunk, ...args);
    record(chunk, args);
    return ended;
  };
  const setMethod = (name, method) => {
    try {
      return Reflect.set(stream, name, method);
    } catch {
      return false;
    }
  };
  // Bun on Windows exposes native stdin methods as read-only. Keep the stream
  // usable even when its methods cannot be wrapped for input snapshots.
  if (!setMethod('write', trackedWrite)) {
    trace('ProcessRunner', () => 'Native stdin.write is read-only');
    return stream;
  }
  if (!setMethod('end', trackedEnd)) {
    setMethod('write', write);
    trace('ProcessRunner', () => 'Native stdin.end is read-only');
  }
  return stream;
}

/**
 * Check if command is a virtual command
 * @param {object} self - ProcessRunner instance
 * @returns {boolean}
 */
function isVirtualCommand(self) {
  return (
    self._virtualGenerator ||
    (self.spec &&
      self.spec.command &&
      virtualCommands.has(self.spec.command.split(' ')[0]))
  );
}

/**
 * Create the stable handle returned while command startup is still pending.
 *
 * Starting a shell command crosses an async boundary before its native child
 * exists. Keeping this handle stable lets callers retain `runner.child` and
 * stop the command immediately, while its properties begin reflecting the
 * native child as soon as it is spawned.
 *
 * @param {ProcessRunner} runner - Owning runner
 * @returns {object} Pending child handle
 */
function createPendingChildHandle(runner) {
  return {
    get native() {
      return runner._child;
    },
    get pid() {
      return runner._child?.pid;
    },
    get stdin() {
      return runner._child?.stdin ?? null;
    },
    get stdout() {
      return runner._child?.stdout ?? null;
    },
    get stderr() {
      return runner._child?.stderr ?? null;
    },
    get killed() {
      return runner._cancelled || Boolean(runner._child?.killed);
    },
    get exitCode() {
      return runner._child?.exitCode ?? runner.result?.code ?? null;
    },
    get signalCode() {
      return runner._child?.signalCode ?? runner._cancellationSignal ?? null;
    },
    kill(signal) {
      if (runner.finished) {
        return false;
      }
      runner.kill(signal);
      return true;
    },
  };
}

/**
 * Get stream from child or wait for it
 * @param {object} self - ProcessRunner instance
 * @param {string} streamName - Name of stream
 * @param {boolean} checkVirtual - Whether to check for virtual commands
 * @returns {object|Promise|null}
 */
function getOrWaitForStream(self, streamName, checkVirtual = true) {
  self._autoStartIfNeeded(`streams.${streamName} access`);

  if (self._child && self._child[streamName]) {
    return self._child[streamName];
  }
  if (self.finished) {
    return null;
  }
  if (checkVirtual && isVirtualCommand(self)) {
    return null;
  }
  if (!self.started) {
    self._startAsync();
    return waitForChildStream(self, streamName);
  }
  if (self.promise && !self._child) {
    return waitForChildStream(self, streamName);
  }
  return null;
}

/**
 * Get stdin stream with special handling for pipe mode
 * @param {object} self - ProcessRunner instance
 * @returns {object|Promise|null}
 */
function getStdinStream(self) {
  self._autoStartIfNeeded('streams.stdin access');

  if (self._child && self._child.stdin) {
    return trackStdinWrites(self, self._child.stdin);
  }
  if (self.finished) {
    return null;
  }

  const isVirtual = isVirtualCommand(self);
  const willFallbackToReal = isVirtual && self.options.stdin === 'pipe';

  if (isVirtual && !willFallbackToReal) {
    return null;
  }
  if (!self.started) {
    self._startAsync();
    return waitForChildStream(self, 'stdin').then((stream) =>
      trackStdinWrites(self, stream)
    );
  }
  if (self.promise && !self._child) {
    return waitForChildStream(self, 'stdin').then((stream) =>
      trackStdinWrites(self, stream)
    );
  }
  return null;
}

/**
 * Cleanup abort controller
 * @param {object} runner - ProcessRunner instance
 */
function cleanupAbortController(runner) {
  if (!runner._abortController) {
    return;
  }
  trace('ProcessRunner', () => 'Cleaning up abort controller');
  try {
    runner._abortController.abort();
  } catch (e) {
    trace('ProcessRunner', () => `Error aborting controller: ${e.message}`);
  }
  runner._abortController = null;
}

/**
 * Cleanup child process reference
 * @param {object} runner - ProcessRunner instance
 */
function cleanupChildProcess(runner) {
  if (!runner._child) {
    return;
  }
  trace(
    'ProcessRunner',
    () => `Cleaning up child process ${runner._child.pid}`
  );
  try {
    runner._child.removeAllListeners?.();
  } catch (e) {
    trace('ProcessRunner', () => `Error removing listeners: ${e.message}`);
  }
  runner._child = null;
}

/**
 * Cleanup virtual generator
 * @param {object} runner - ProcessRunner instance
 */
function cleanupGenerator(runner) {
  if (!runner._virtualGenerator) {
    return;
  }
  trace('ProcessRunner', () => 'Cleaning up virtual generator');
  try {
    if (runner._virtualGenerator.return) {
      runner._virtualGenerator.return();
    }
  } catch (e) {
    trace('ProcessRunner', () => `Error closing generator: ${e.message}`);
  }
  runner._virtualGenerator = null;
}

/**
 * Cleanup pipeline components
 * @param {object} runner - ProcessRunner instance
 */
function cleanupPipeline(runner) {
  if (runner.spec?.mode !== 'pipeline') {
    return;
  }
  trace('ProcessRunner', () => 'Cleaning up pipeline components');
  if (runner.spec.source && typeof runner.spec.source._cleanup === 'function') {
    runner.spec.source._cleanup();
  }
  if (
    runner.spec.destination &&
    typeof runner.spec.destination._cleanup === 'function'
  ) {
    runner.spec.destination._cleanup();
  }
}

/**
 * ProcessRunner - Enhanced process runner with streaming capabilities
 * Extends StreamEmitter for event-based output handling
 */
class ProcessRunner extends StreamEmitter {
  constructor(spec, options = {}) {
    super();

    trace(
      'ProcessRunner',
      () =>
        `constructor ENTER | ${JSON.stringify(
          {
            spec:
              typeof spec === 'object'
                ? { ...spec, command: spec.command?.slice(0, 100) }
                : spec,
            options,
          },
          null,
          2
        )}`
    );

    this.spec = spec;
    this.options = {
      mirror: true,
      capture: true,
      stdin: 'inherit',
      cwd: undefined,
      env: undefined,
      interactive: false,
      shellOperators: true,
      killSignal: 'SIGTERM',
      killGrace: 100,
      ...options,
    };

    this.outChunks = this.options.capture ? [] : null;
    this.errChunks = this.options.capture ? [] : null;
    // Capture stdin when it is actually written. Pre-populating this array
    // duplicates explicit string/Buffer input when handleStdin() records the
    // same bytes during execution.
    this.inChunks = [];

    this.result = null;
    this._child = null;
    this._pendingChild = createPendingChildHandle(this);
    // Process id of the spawned child, recorded at spawn time. `child` is
    // released by _cleanup() once the command finishes, so reading the pid from
    // it only works while the process is alive; this copy is what makes the
    // `pid` getter answer after completion too (issue #18).
    this._pid = undefined;
    this.started = false;
    this.finished = false;

    this.promise = null;
    this._mode = null;

    this._cancelled = false;
    this._cancellationSignal = null;
    this._virtualGenerator = null;
    this._activeNestedRunner = null;
    this._abortController = new AbortController();

    // Set to true once user code starts consuming this runner (await / then /
    // catch / finally / async iteration). Used by the global test-isolation
    // reaper (cleanupActiveRunners) to avoid force-terminating a command that
    // is still being awaited, which would mask its real exit code with a
    // synthetic SIGTERM result (see issue #170).
    this._awaited = false;

    activeProcessRunners.add(this);
    monitorParentStreams();

    trace(
      'ProcessRunner',
      () =>
        `Added to activeProcessRunners | ${JSON.stringify(
          {
            command: this.spec?.command || 'unknown',
            totalActive: activeProcessRunners.size,
          },
          null,
          2
        )}`
    );
    installSignalHandlers();

    this.finished = false;
  }

  /**
   * Process id of the command, or `undefined` when there is no operating
   * system process to identify.
   *
   * It is `undefined` before the command starts, and stays `undefined` for
   * built-in (virtual) commands such as `echo` or `sleep`, which run inside
   * this process and never spawn a child. Once a real command has been
   * spawned the value is stable: it remains readable after the command
   * finishes, unlike `child`, which is released during cleanup.
   *
   * @returns {number|undefined}
   */
  get pid() {
    return this._pid;
  }

  /**
   * Child process handle for the command.
   *
   * Reading this property starts a lazy command. During asynchronous startup
   * it returns a stable pending handle whose `kill(signal)` method can cancel
   * the command before an operating-system process exists. Once a real child
   * has spawned, later reads return the runtime-native child object; the early
   * handle's properties continue to reflect that object through `native`.
   * Built-in commands never spawn a native process but can still be stopped
   * through the pending handle. Cleanup releases the handle and returns `null`
   * after completion.
   *
   * @returns {object|null}
   */
  get child() {
    if (this.finished) {
      return null;
    }
    if (!this.started) {
      this._startAsync();
    }
    return this._child ?? this._pendingChild;
  }

  // Stream property getters
  get stdout() {
    trace(
      'ProcessRunner',
      () =>
        `stdout getter accessed | ${JSON.stringify(
          {
            hasChild: !!this._child,
            hasStdout: !!(this._child && this._child.stdout),
          },
          null,
          2
        )}`
    );
    return this._child ? this._child.stdout : null;
  }

  get stderr() {
    trace(
      'ProcessRunner',
      () =>
        `stderr getter accessed | ${JSON.stringify(
          {
            hasChild: !!this._child,
            hasStderr: !!(this._child && this._child.stderr),
          },
          null,
          2
        )}`
    );
    return this._child ? this._child.stderr : null;
  }

  get stdin() {
    trace(
      'ProcessRunner',
      () =>
        `stdin getter accessed | ${JSON.stringify(
          {
            hasChild: !!this._child,
            hasStdin: !!(this._child && this._child.stdin),
          },
          null,
          2
        )}`
    );
    return this._child ? trackStdinWrites(this, this._child.stdin) : null;
  }

  _autoStartIfNeeded(reason) {
    if (!this.started && !this.finished) {
      trace('ProcessRunner', () => `Auto-starting process due to ${reason}`);
      this.start({
        mode: 'async',
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    }
  }

  get streams() {
    const self = this;
    return {
      get stdin() {
        trace('ProcessRunner.streams', () => `stdin access`);
        return getStdinStream(self);
      },
      get stdout() {
        trace('ProcessRunner.streams', () => `stdout access`);
        return getOrWaitForStream(self, 'stdout');
      },
      get stderr() {
        trace('ProcessRunner.streams', () => `stderr access`);
        return getOrWaitForStream(self, 'stderr');
      },
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
        return self.then
          ? self.then((result) => Buffer.from(result.stdin || '', 'utf8'))
          : Promise.resolve(Buffer.alloc(0));
      },
      get stdout() {
        self._autoStartIfNeeded('buffers.stdout access');
        if (self.finished && self.result) {
          return Buffer.from(self.result.stdout || '', 'utf8');
        }
        return self.then
          ? self.then((result) => Buffer.from(result.stdout || '', 'utf8'))
          : Promise.resolve(Buffer.alloc(0));
      },
      get stderr() {
        self._autoStartIfNeeded('buffers.stderr access');
        if (self.finished && self.result) {
          return Buffer.from(self.result.stderr || '', 'utf8');
        }
        return self.then
          ? self.then((result) => Buffer.from(result.stderr || '', 'utf8'))
          : Promise.resolve(Buffer.alloc(0));
      },
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
        return self.then
          ? self.then((result) => String(result.stdin ?? ''))
          : Promise.resolve('');
      },
      get stdout() {
        self._autoStartIfNeeded('strings.stdout access');
        if (self.finished && self.result) {
          return self.result.stdout || '';
        }
        return self.then
          ? self.then((result) => String(result.stdout ?? ''))
          : Promise.resolve('');
      },
      get stderr() {
        self._autoStartIfNeeded('strings.stderr access');
        if (self.finished && self.result) {
          return self.result.stderr || '';
        }
        return self.then
          ? self.then((result) => String(result.stderr ?? ''))
          : Promise.resolve('');
      },
    };
  }

  // Centralized method to properly finish a process with correct event emission order
  finish(result) {
    // Ensure `exitCode` is always available as an alias for `code` (issue #36).
    // This is the single choke point every result passes through before it is
    // stored and returned to the user, so normalizing here covers all paths.
    if (result && result.exitCode === undefined && result.code !== undefined) {
      result.exitCode = result.code;
    }
    ensureResultText(result);

    trace(
      'ProcessRunner',
      () =>
        `finish() called | ${JSON.stringify(
          {
            alreadyFinished: this.finished,
            resultCode: result?.code,
            hasStdout: !!result?.stdout,
            hasStderr: !!result?.stderr,
            command: this.spec?.command?.slice(0, 50),
          },
          null,
          2
        )}`
    );

    if (this.finished) {
      trace(
        'ProcessRunner',
        () => `Already finished, returning existing result`
      );
      return this.result || result;
    }

    this.result = result;
    trace('ProcessRunner', () => `Result stored, about to emit events`);

    this.emit('end', result);
    trace('ProcessRunner', () => `'end' event emitted`);
    this.emit('exit', result.code);
    trace(
      'ProcessRunner',
      () => `'exit' event emitted with code ${result.code}`
    );

    this.finished = true;
    trace('ProcessRunner', () => `Marked as finished, calling cleanup`);

    this._cleanup();
    trace('ProcessRunner', () => `Cleanup completed`);

    return result;
  }

  _emitProcessedData(type, buf) {
    if (this._cancelled) {
      trace(
        'ProcessRunner',
        () => 'Skipping data emission - process cancelled'
      );
      return;
    }
    const processedBuf = processOutput(buf, this.options.ansi);
    this.emit(type, processedBuf);
    this.emit('data', { type, data: processedBuf });
  }

  _handleParentStreamClosure() {
    if (this.finished || this._cancelled) {
      trace(
        'ProcessRunner',
        () =>
          `Parent stream closure ignored | ${JSON.stringify({
            finished: this.finished,
            cancelled: this._cancelled,
          })}`
      );
      return;
    }

    // Never tear down a command that user code is actively awaiting (issue #170).
    // Graceful shutdown on parent-stream closure exists for fire-and-forget /
    // streamed commands whose output consumer went away; when the result is being
    // awaited, the await is the authoritative consumer. A spurious parent
    // stdout/stderr 'close' — observed on Windows/Bun, which also logged
    // "11 close listeners added to [WriteStream]" in run 27310950658 — must not
    // preempt the awaited result and replace the real exit code with a synthetic
    // SIGTERM (143).
    if (this._awaited) {
      trace(
        'ProcessRunner',
        () =>
          `Parent stream closure ignored for awaited command | ${JSON.stringify(
            {
              command: this.spec?.command?.slice(0, 50) || this.spec?.file,
            }
          )}`
      );
      return;
    }

    trace(
      'ProcessRunner',
      () =>
        `Handling parent stream closure | ${JSON.stringify(
          {
            started: this.started,
            hasChild: !!this._child,
            command: this.spec.command?.slice(0, 50) || this.spec.file,
          },
          null,
          2
        )}`
    );

    this._cancelled = true;

    if (this._abortController) {
      this._abortController.abort();
    }

    if (this._child) {
      try {
        if (this._child.stdin && typeof this._child.stdin.end === 'function') {
          this._child.stdin.end();
        } else if (
          isBun &&
          this._child.stdin &&
          typeof this._child.stdin.getWriter === 'function'
        ) {
          const writer = this._child.stdin.getWriter();
          writer.close().catch(() => {});
        }

        setImmediate(() => {
          if (this._child && !this.finished) {
            trace(
              'ProcessRunner',
              () => 'Terminating child process after parent stream closure'
            );
            if (typeof this._child.kill === 'function') {
              this._child.kill('SIGTERM');
            }
          }
        });
      } catch (error) {
        trace(
          'ProcessRunner',
          () =>
            `Error during graceful shutdown | ${JSON.stringify({ error: error.message }, null, 2)}`
        );
      }
    }

    this._cleanup();
  }

  _cleanup() {
    trace(
      'ProcessRunner',
      () => `_cleanup() | active=${activeProcessRunners.size}`
    );

    activeProcessRunners.delete(this);
    cleanupPipeline(this);

    if (activeProcessRunners.size === 0) {
      uninstallSignalHandlers();
    }

    if (this.listeners) {
      this.listeners.clear();
    }

    cleanupAbortController(this);
    cleanupChildProcess(this);
    cleanupGenerator(this);

    trace('ProcessRunner', () => `_cleanup() completed`);
  }
}

export { ProcessRunner, isBun };
