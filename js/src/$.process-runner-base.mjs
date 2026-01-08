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
        trace(
          'ProcessRunner.streams',
          () =>
            `stdin access | ${JSON.stringify(
              {
                hasChild: !!self.child,
                hasStdin: !!(self.child && self.child.stdin),
                started: self.started,
                finished: self.finished,
                hasPromise: !!self.promise,
                command: self.spec?.command?.slice(0, 50),
              },
              null,
              2
            )}`
        );

        self._autoStartIfNeeded('streams.stdin access');

        if (self.child && self.child.stdin) {
          trace(
            'ProcessRunner.streams',
            () => 'stdin: returning existing stream'
          );
          return self.child.stdin;
        }
        if (self.finished) {
          trace(
            'ProcessRunner.streams',
            () => 'stdin: process finished, returning null'
          );
          return null;
        }

        const isVirtualCommand =
          self._virtualGenerator ||
          (self.spec &&
            self.spec.command &&
            virtualCommands.has(self.spec.command.split(' ')[0]));
        const willFallbackToReal =
          isVirtualCommand && self.options.stdin === 'pipe';

        if (isVirtualCommand && !willFallbackToReal) {
          trace(
            'ProcessRunner.streams',
            () => 'stdin: virtual command, returning null'
          );
          return null;
        }

        if (!self.started) {
          trace(
            'ProcessRunner.streams',
            () => 'stdin: not started, starting and waiting for child'
          );
          self._startAsync();
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

        if (self.promise && !self.child) {
          trace(
            'ProcessRunner.streams',
            () => 'stdin: process starting, waiting for child'
          );
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

        trace(
          'ProcessRunner.streams',
          () => 'stdin: returning null (no conditions met)'
        );
        return null;
      },
      get stdout() {
        trace(
          'ProcessRunner.streams',
          () =>
            `stdout access | ${JSON.stringify(
              {
                hasChild: !!self.child,
                hasStdout: !!(self.child && self.child.stdout),
                started: self.started,
                finished: self.finished,
                hasPromise: !!self.promise,
                command: self.spec?.command?.slice(0, 50),
              },
              null,
              2
            )}`
        );

        self._autoStartIfNeeded('streams.stdout access');

        if (self.child && self.child.stdout) {
          trace(
            'ProcessRunner.streams',
            () => 'stdout: returning existing stream'
          );
          return self.child.stdout;
        }
        if (self.finished) {
          trace(
            'ProcessRunner.streams',
            () => 'stdout: process finished, returning null'
          );
          return null;
        }

        if (
          self._virtualGenerator ||
          (self.spec &&
            self.spec.command &&
            virtualCommands.has(self.spec.command.split(' ')[0]))
        ) {
          trace(
            'ProcessRunner.streams',
            () => 'stdout: virtual command, returning null'
          );
          return null;
        }

        if (!self.started) {
          trace(
            'ProcessRunner.streams',
            () => 'stdout: not started, starting and waiting for child'
          );
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
          trace(
            'ProcessRunner.streams',
            () => 'stdout: process starting, waiting for child'
          );
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

        trace(
          'ProcessRunner.streams',
          () => 'stdout: returning null (no conditions met)'
        );
        return null;
      },
      get stderr() {
        trace(
          'ProcessRunner.streams',
          () =>
            `stderr access | ${JSON.stringify(
              {
                hasChild: !!self.child,
                hasStderr: !!(self.child && self.child.stderr),
                started: self.started,
                finished: self.finished,
                hasPromise: !!self.promise,
                command: self.spec?.command?.slice(0, 50),
              },
              null,
              2
            )}`
        );

        self._autoStartIfNeeded('streams.stderr access');

        if (self.child && self.child.stderr) {
          trace(
            'ProcessRunner.streams',
            () => 'stderr: returning existing stream'
          );
          return self.child.stderr;
        }
        if (self.finished) {
          trace(
            'ProcessRunner.streams',
            () => 'stderr: process finished, returning null'
          );
          return null;
        }

        if (
          self._virtualGenerator ||
          (self.spec &&
            self.spec.command &&
            virtualCommands.has(self.spec.command.split(' ')[0]))
        ) {
          trace(
            'ProcessRunner.streams',
            () => 'stderr: virtual command, returning null'
          );
          return null;
        }

        if (!self.started) {
          trace(
            'ProcessRunner.streams',
            () => 'stderr: not started, starting and waiting for child'
          );
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
          trace(
            'ProcessRunner.streams',
            () => 'stderr: process starting, waiting for child'
          );
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

        trace(
          'ProcessRunner.streams',
          () => 'stderr: returning null (no conditions met)'
        );
        return null;
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
      () =>
        `_cleanup() called | ${JSON.stringify(
          {
            wasActiveBeforeCleanup: activeProcessRunners.has(this),
            totalActiveBefore: activeProcessRunners.size,
            finished: this.finished,
            hasChild: !!this.child,
            command: this.spec?.command?.slice(0, 50),
          },
          null,
          2
        )}`
    );

    const wasActive = activeProcessRunners.has(this);
    activeProcessRunners.delete(this);

    if (wasActive) {
      trace(
        'ProcessRunner',
        () =>
          `Removed from activeProcessRunners | ${JSON.stringify(
            {
              command: this.spec?.command || 'unknown',
              totalActiveAfter: activeProcessRunners.size,
              remainingCommands: Array.from(activeProcessRunners).map((r) =>
                r.spec?.command?.slice(0, 30)
              ),
            },
            null,
            2
          )}`
      );
    } else {
      trace(
        'ProcessRunner',
        () => `Was not in activeProcessRunners (already cleaned up)`
      );
    }

    if (this.spec?.mode === 'pipeline') {
      trace('ProcessRunner', () => 'Cleaning up pipeline components');
      if (this.spec.source && typeof this.spec.source._cleanup === 'function') {
        this.spec.source._cleanup();
      }
      if (
        this.spec.destination &&
        typeof this.spec.destination._cleanup === 'function'
      ) {
        this.spec.destination._cleanup();
      }
    }

    if (activeProcessRunners.size === 0) {
      uninstallSignalHandlers();
    }

    if (this.listeners) {
      this.listeners.clear();
    }

    if (this._abortController) {
      trace(
        'ProcessRunner',
        () =>
          `Cleaning up abort controller during cleanup | ${JSON.stringify(
            {
              wasAborted: this._abortController?.signal?.aborted,
            },
            null,
            2
          )}`
      );
      try {
        this._abortController.abort();
        trace(
          'ProcessRunner',
          () => `Abort controller aborted successfully during cleanup`
        );
      } catch (e) {
        trace(
          'ProcessRunner',
          () => `Error aborting controller during cleanup: ${e.message}`
        );
      }
      this._abortController = null;
      trace(
        'ProcessRunner',
        () => `Abort controller reference cleared during cleanup`
      );
    } else {
      trace(
        'ProcessRunner',
        () => `No abort controller to clean up during cleanup`
      );
    }

    if (this.child) {
      trace(
        'ProcessRunner',
        () =>
          `Cleaning up child process reference | ${JSON.stringify(
            {
              hasChild: true,
              childPid: this.child.pid,
              childKilled: this.child.killed,
            },
            null,
            2
          )}`
      );
      try {
        this.child.removeAllListeners?.();
        trace(
          'ProcessRunner',
          () => `Child process listeners removed successfully`
        );
      } catch (e) {
        trace(
          'ProcessRunner',
          () => `Error removing child process listeners: ${e.message}`
        );
      }
      this.child = null;
      trace('ProcessRunner', () => `Child process reference cleared`);
    } else {
      trace('ProcessRunner', () => `No child process reference to clean up`);
    }

    if (this._virtualGenerator) {
      trace(
        'ProcessRunner',
        () =>
          `Cleaning up virtual generator | ${JSON.stringify(
            {
              hasReturn: !!this._virtualGenerator.return,
            },
            null,
            2
          )}`
      );
      try {
        if (this._virtualGenerator.return) {
          this._virtualGenerator.return();
          trace(
            'ProcessRunner',
            () => `Virtual generator return() called successfully`
          );
        }
      } catch (e) {
        trace(
          'ProcessRunner',
          () => `Error calling virtual generator return(): ${e.message}`
        );
      }
      this._virtualGenerator = null;
      trace('ProcessRunner', () => `Virtual generator reference cleared`);
    } else {
      trace('ProcessRunner', () => `No virtual generator to clean up`);
    }

    trace(
      'ProcessRunner',
      () =>
        `_cleanup() completed | ${JSON.stringify(
          {
            totalActiveAfter: activeProcessRunners.size,
            sigintListenerCount: process.listeners('SIGINT').length,
          },
          null,
          2
        )}`
    );
  }
}

export { ProcessRunner, isBun };
