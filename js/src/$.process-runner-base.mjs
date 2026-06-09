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
      if (self.child && self.child[streamName]) {
        resolve(self.child[streamName]);
      } else if (self.finished || self._virtualGenerator) {
        resolve(null);
      } else {
        setImmediate(checkForChild);
      }
    };
    setImmediate(checkForChild);
  });
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
 * Get stream from child or wait for it
 * @param {object} self - ProcessRunner instance
 * @param {string} streamName - Name of stream
 * @param {boolean} checkVirtual - Whether to check for virtual commands
 * @returns {object|Promise|null}
 */
function getOrWaitForStream(self, streamName, checkVirtual = true) {
  self._autoStartIfNeeded(`streams.${streamName} access`);

  if (self.child && self.child[streamName]) {
    return self.child[streamName];
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
  if (self.promise && !self.child) {
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

  if (self.child && self.child.stdin) {
    return self.child.stdin;
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
    return waitForChildStream(self, 'stdin');
  }
  if (self.promise && !self.child) {
    return waitForChildStream(self, 'stdin');
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
  if (!runner.child) {
    return;
  }
  trace('ProcessRunner', () => `Cleaning up child process ${runner.child.pid}`);
  try {
    runner.child.removeAllListeners?.();
  } catch (e) {
    trace('ProcessRunner', () => `Error removing listeners: ${e.message}`);
  }
  runner.child = null;
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
      ...options,
    };

    this.outChunks = this.options.capture ? [] : null;
    this.errChunks = this.options.capture ? [] : null;
    this.inChunks =
      this.options.capture && this.options.stdin === 'inherit'
        ? []
        : this.options.capture &&
            (typeof this.options.stdin === 'string' ||
              Buffer.isBuffer(this.options.stdin))
          ? [Buffer.from(this.options.stdin)]
          : [];

    this.result = null;
    this.child = null;
    this.started = false;
    this.finished = false;

    this.promise = null;
    this._mode = null;

    this._cancelled = false;
    this._cancellationSignal = null;
    this._virtualGenerator = null;
    this._abortController = new AbortController();

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

  // Stream property getters
  get stdout() {
    trace(
      'ProcessRunner',
      () =>
        `stdout getter accessed | ${JSON.stringify(
          {
            hasChild: !!this.child,
            hasStdout: !!(this.child && this.child.stdout),
          },
          null,
          2
        )}`
    );
    return this.child ? this.child.stdout : null;
  }

  get stderr() {
    trace(
      'ProcessRunner',
      () =>
        `stderr getter accessed | ${JSON.stringify(
          {
            hasChild: !!this.child,
            hasStderr: !!(this.child && this.child.stderr),
          },
          null,
          2
        )}`
    );
    return this.child ? this.child.stderr : null;
  }

  get stdin() {
    trace(
      'ProcessRunner',
      () =>
        `stdin getter accessed | ${JSON.stringify(
          {
            hasChild: !!this.child,
            hasStdin: !!(this.child && this.child.stdin),
          },
          null,
          2
        )}`
    );
    return this.child ? this.child.stdin : null;
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
          ? self.then((result) => result.stdin || '')
          : Promise.resolve('');
      },
      get stdout() {
        self._autoStartIfNeeded('strings.stdout access');
        if (self.finished && self.result) {
          return self.result.stdout || '';
        }
        return self.then
          ? self.then((result) => result.stdout || '')
          : Promise.resolve('');
      },
      get stderr() {
        self._autoStartIfNeeded('strings.stderr access');
        if (self.finished && self.result) {
          return self.result.stderr || '';
        }
        return self.then
          ? self.then((result) => result.stderr || '')
          : Promise.resolve('');
      },
    };
  }

  // Centralized method to properly finish a process with correct event emission order
  finish(result) {
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

    trace(
      'ProcessRunner',
      () =>
        `Handling parent stream closure | ${JSON.stringify(
          {
            started: this.started,
            hasChild: !!this.child,
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

    if (this.child) {
      try {
        if (this.child.stdin && typeof this.child.stdin.end === 'function') {
          this.child.stdin.end();
        } else if (
          isBun &&
          this.child.stdin &&
          typeof this.child.stdin.getWriter === 'function'
        ) {
          const writer = this.child.stdin.getWriter();
          writer.close().catch(() => {});
        }

        setImmediate(() => {
          if (this.child && !this.finished) {
            trace(
              'ProcessRunner',
              () => 'Terminating child process after parent stream closure'
            );
            if (typeof this.child.kill === 'function') {
              this.child.kill('SIGTERM');
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
