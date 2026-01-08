// ProcessRunner stream and kill methods - streaming and process termination
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import { createResult } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Attach stream and kill methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies (not used but kept for consistency)
 */
export function attachStreamKillMethods(ProcessRunner) {
  ProcessRunner.prototype[Symbol.asyncIterator] = async function* () {
    yield* this.stream();
  };

  ProcessRunner.prototype.stream = async function* () {
    trace(
      'ProcessRunner',
      () =>
        `stream ENTER | ${JSON.stringify(
          {
            started: this.started,
            finished: this.finished,
            command: this.spec?.command?.slice(0, 100),
          },
          null,
          2
        )}`
    );

    this._isStreaming = true;

    if (!this.started) {
      trace(
        'ProcessRunner',
        () => 'Auto-starting async process from stream() with streaming mode'
      );
      this._startAsync();
    }

    let buffer = [];
    let resolve, reject;
    let ended = false;
    let cleanedUp = false;
    let killed = false;

    const onData = (chunk) => {
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
        if (killed) {
          trace('ProcessRunner', () => 'Stream killed, stopping iteration');
          break;
        }
        if (buffer.length > 0) {
          const chunk = buffer.shift();
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

      if (!this.finished) {
        killed = true;
        buffer = [];
        this._streamBreaking = true;
        this.kill();
      }
    }
  };

  ProcessRunner.prototype.kill = function (signal = 'SIGTERM') {
    trace(
      'ProcessRunner',
      () =>
        `kill ENTER | ${JSON.stringify(
          {
            signal,
            cancelled: this._cancelled,
            finished: this.finished,
            hasChild: !!this.child,
            hasVirtualGenerator: !!this._virtualGenerator,
            command: this.spec?.command?.slice(0, 50) || 'unknown',
          },
          null,
          2
        )}`
    );

    if (this.finished) {
      trace('ProcessRunner', () => 'Already finished, skipping kill');
      return;
    }

    trace(
      'ProcessRunner',
      () =>
        `Marking as cancelled | ${JSON.stringify(
          {
            signal,
            previouslyCancelled: this._cancelled,
            previousSignal: this._cancellationSignal,
          },
          null,
          2
        )}`
    );
    this._cancelled = true;
    this._cancellationSignal = signal;

    if (this.spec?.mode === 'pipeline') {
      trace('ProcessRunner', () => 'Killing pipeline components');
      if (this.spec.source && typeof this.spec.source.kill === 'function') {
        this.spec.source.kill(signal);
      }
      if (
        this.spec.destination &&
        typeof this.spec.destination.kill === 'function'
      ) {
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

    if (this._abortController) {
      trace(
        'ProcessRunner',
        () =>
          `Aborting internal controller | ${JSON.stringify(
            {
              wasAborted: this._abortController?.signal?.aborted,
            },
            null,
            2
          )}`
      );
      this._abortController.abort();
      trace(
        'ProcessRunner',
        () =>
          `Internal controller aborted | ${JSON.stringify(
            {
              nowAborted: this._abortController?.signal?.aborted,
            },
            null,
            2
          )}`
      );
    } else {
      trace('ProcessRunner', () => 'No abort controller to abort');
    }

    if (this._virtualGenerator) {
      trace(
        'ProcessRunner',
        () =>
          `Virtual generator found for cleanup | ${JSON.stringify(
            {
              hasReturn: typeof this._virtualGenerator.return === 'function',
              hasThrow: typeof this._virtualGenerator.throw === 'function',
              cancelled: this._cancelled,
              signal,
            },
            null,
            2
          )}`
      );

      if (this._virtualGenerator.return) {
        trace('ProcessRunner', () => 'Closing virtual generator with return()');
        try {
          this._virtualGenerator.return();
          trace('ProcessRunner', () => 'Virtual generator closed successfully');
        } catch (err) {
          trace(
            'ProcessRunner',
            () =>
              `Error closing generator | ${JSON.stringify(
                {
                  error: err.message,
                  stack: err.stack?.slice(0, 200),
                },
                null,
                2
              )}`
          );
        }
      } else {
        trace(
          'ProcessRunner',
          () => 'Virtual generator has no return() method'
        );
      }
    } else {
      trace(
        'ProcessRunner',
        () =>
          `No virtual generator to cleanup | ${JSON.stringify(
            {
              hasVirtualGenerator: !!this._virtualGenerator,
            },
            null,
            2
          )}`
      );
    }

    if (this.child && !this.finished) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: hasChild => killing | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`
      );
      try {
        if (this.child.pid) {
          if (isBun) {
            trace(
              'ProcessRunner',
              () =>
                `Killing Bun process | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`
            );

            const killOperations = [];

            try {
              process.kill(this.child.pid, 'SIGTERM');
              trace(
                'ProcessRunner',
                () => `Sent SIGTERM to Bun process ${this.child.pid}`
              );
              killOperations.push('SIGTERM to process');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error sending SIGTERM to Bun process: ${err.message}`
              );
            }

            try {
              process.kill(-this.child.pid, 'SIGTERM');
              trace(
                'ProcessRunner',
                () => `Sent SIGTERM to Bun process group -${this.child.pid}`
              );
              killOperations.push('SIGTERM to group');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Bun process group SIGTERM failed: ${err.message}`
              );
            }

            try {
              process.kill(this.child.pid, 'SIGKILL');
              trace(
                'ProcessRunner',
                () => `Sent SIGKILL to Bun process ${this.child.pid}`
              );
              killOperations.push('SIGKILL to process');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error sending SIGKILL to Bun process: ${err.message}`
              );
            }

            try {
              process.kill(-this.child.pid, 'SIGKILL');
              trace(
                'ProcessRunner',
                () => `Sent SIGKILL to Bun process group -${this.child.pid}`
              );
              killOperations.push('SIGKILL to group');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Bun process group SIGKILL failed: ${err.message}`
              );
            }

            trace(
              'ProcessRunner',
              () =>
                `Bun kill operations attempted: ${killOperations.join(', ')}`
            );

            try {
              this.child.kill();
              trace(
                'ProcessRunner',
                () => `Called child.kill() for Bun process ${this.child.pid}`
              );
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error calling child.kill(): ${err.message}`
              );
            }

            if (this.child) {
              this.child.removeAllListeners?.();
              this.child = null;
            }
          } else {
            trace(
              'ProcessRunner',
              () =>
                `Killing Node process | ${JSON.stringify({ pid: this.child.pid }, null, 2)}`
            );

            const killOperations = [];

            try {
              process.kill(this.child.pid, 'SIGTERM');
              trace(
                'ProcessRunner',
                () => `Sent SIGTERM to process ${this.child.pid}`
              );
              killOperations.push('SIGTERM to process');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error sending SIGTERM to process: ${err.message}`
              );
            }

            try {
              process.kill(-this.child.pid, 'SIGTERM');
              trace(
                'ProcessRunner',
                () => `Sent SIGTERM to process group -${this.child.pid}`
              );
              killOperations.push('SIGTERM to group');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Process group SIGTERM failed: ${err.message}`
              );
            }

            try {
              process.kill(this.child.pid, 'SIGKILL');
              trace(
                'ProcessRunner',
                () => `Sent SIGKILL to process ${this.child.pid}`
              );
              killOperations.push('SIGKILL to process');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error sending SIGKILL to process: ${err.message}`
              );
            }

            try {
              process.kill(-this.child.pid, 'SIGKILL');
              trace(
                'ProcessRunner',
                () => `Sent SIGKILL to process group -${this.child.pid}`
              );
              killOperations.push('SIGKILL to group');
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Process group SIGKILL failed: ${err.message}`
              );
            }

            trace(
              'ProcessRunner',
              () => `Kill operations attempted: ${killOperations.join(', ')}`
            );

            if (this.child) {
              this.child.removeAllListeners?.();
              this.child = null;
            }
          }
        }
      } catch (err) {
        trace(
          'ProcessRunner',
          () =>
            `Error killing process | ${JSON.stringify({ error: err.message }, null, 2)}`
        );
        console.error('Error killing process:', err.message);
      }
    }

    const result = createResult({
      code: signal === 'SIGKILL' ? 137 : signal === 'SIGTERM' ? 143 : 130,
      stdout: '',
      stderr: `Process killed with ${signal}`,
      stdin: '',
    });
    this.finish(result);

    trace(
      'ProcessRunner',
      () =>
        `kill EXIT | ${JSON.stringify(
          {
            cancelled: this._cancelled,
            finished: this.finished,
          },
          null,
          2
        )}`
    );
  };
}
