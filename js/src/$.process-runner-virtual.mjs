// ProcessRunner virtual command methods - virtual command execution
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import { safeWrite } from './$.stream-utils.mjs';

/**
 * Attach virtual command methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies
 */
export function attachVirtualCommandMethods(ProcessRunner, deps) {
  const { virtualCommands, globalShellSettings } = deps;

  ProcessRunner.prototype._runVirtual = async function (
    cmd,
    args,
    originalCommand = null
  ) {
    trace(
      'ProcessRunner',
      () =>
        `_runVirtual ENTER | ${JSON.stringify({ cmd, args, originalCommand }, null, 2)}`
    );

    const handler = virtualCommands.get(cmd);
    if (!handler) {
      trace(
        'ProcessRunner',
        () => `Virtual command not found | ${JSON.stringify({ cmd }, null, 2)}`
      );
      throw new Error(`Virtual command not found: ${cmd}`);
    }

    trace(
      'ProcessRunner',
      () =>
        `Found virtual command handler | ${JSON.stringify(
          {
            cmd,
            isGenerator: handler.constructor.name === 'AsyncGeneratorFunction',
          },
          null,
          2
        )}`
    );

    try {
      let stdinData = '';

      // Special handling for streaming mode (stdin: "pipe")
      if (this.options.stdin === 'pipe') {
        trace(
          'ProcessRunner',
          () =>
            `Virtual command fallback for streaming | ${JSON.stringify({ cmd }, null, 2)}`
        );

        const modifiedOptions = {
          ...this.options,
          stdin: 'pipe',
          _bypassVirtual: true,
        };
        const ProcessRunnerRef = this.constructor;
        const realRunner = new ProcessRunnerRef(
          { mode: 'shell', command: originalCommand || cmd },
          modifiedOptions
        );
        return await realRunner._doStartAsync();
      } else if (this.options.stdin && typeof this.options.stdin === 'string') {
        stdinData = this.options.stdin;
      } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
        stdinData = this.options.stdin.toString('utf8');
      }

      const argValues = args.map((arg) =>
        arg.value !== undefined ? arg.value : arg
      );

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
          cwd: this.options.cwd,
          env: this.options.env,
          options: this.options,
          isCancelled: () => this._cancelled,
        };

        trace(
          'ProcessRunner',
          () =>
            `_runVirtual signal details | ${JSON.stringify(
              {
                cmd,
                hasAbortController: !!this._abortController,
                signalAborted: this._abortController?.signal?.aborted,
                optionsSignalExists: !!this.options.signal,
                optionsSignalAborted: this.options.signal?.aborted,
              },
              null,
              2
            )}`
        );

        const generator = handler({
          args: argValues,
          stdin: stdinData,
          abortSignal: this._abortController?.signal,
          ...commandOptions,
        });
        this._virtualGenerator = generator;

        const cancelPromise = new Promise((resolve) => {
          this._cancelResolve = resolve;
        });

        try {
          const iterator = generator[Symbol.asyncIterator]();
          let done = false;

          while (!done && !this._cancelled) {
            trace(
              'ProcessRunner',
              () =>
                `Virtual command iteration starting | ${JSON.stringify(
                  {
                    cancelled: this._cancelled,
                    streamBreaking: this._streamBreaking,
                  },
                  null,
                  2
                )}`
            );

            const result = await Promise.race([
              iterator.next(),
              cancelPromise.then(() => ({ done: true, cancelled: true })),
            ]);

            trace(
              'ProcessRunner',
              () =>
                `Virtual command iteration result | ${JSON.stringify(
                  {
                    hasValue: !!result.value,
                    done: result.done,
                    cancelled: result.cancelled || this._cancelled,
                  },
                  null,
                  2
                )}`
            );

            if (result.cancelled || this._cancelled) {
              trace(
                'ProcessRunner',
                () =>
                  `Virtual command cancelled - closing generator | ${JSON.stringify(
                    {
                      resultCancelled: result.cancelled,
                      thisCancelled: this._cancelled,
                    },
                    null,
                    2
                  )}`
              );
              if (iterator.return) {
                await iterator.return();
              }
              break;
            }

            done = result.done;

            if (!done) {
              if (this._cancelled) {
                trace(
                  'ProcessRunner',
                  () => 'Skipping chunk processing - cancelled during iteration'
                );
                break;
              }

              const chunk = result.value;
              const buf = Buffer.from(chunk);

              if (this._cancelled || this._streamBreaking) {
                trace(
                  'ProcessRunner',
                  () =>
                    `Cancelled or stream breaking before output - skipping | ${JSON.stringify(
                      {
                        cancelled: this._cancelled,
                        streamBreaking: this._streamBreaking,
                      },
                      null,
                      2
                    )}`
                );
                break;
              }

              chunks.push(buf);

              if (
                !this._cancelled &&
                !this._streamBreaking &&
                this.options.mirror
              ) {
                trace(
                  'ProcessRunner',
                  () =>
                    `Mirroring virtual command output | ${JSON.stringify(
                      {
                        chunkSize: buf.length,
                      },
                      null,
                      2
                    )}`
                );
                safeWrite(process.stdout, buf);
              }

              this._emitProcessedData('stdout', buf);
            }
          }
        } finally {
          this._virtualGenerator = null;
          this._cancelResolve = null;
        }

        result = {
          code: 0,
          stdout: this.options.capture
            ? Buffer.concat(chunks).toString('utf8')
            : undefined,
          stderr: this.options.capture ? '' : undefined,
          stdin: this.options.capture ? stdinData : undefined,
        };
      } else {
        const commandOptions = {
          cwd: this.options.cwd,
          env: this.options.env,
          options: this.options,
          isCancelled: () => this._cancelled,
        };

        trace(
          'ProcessRunner',
          () =>
            `_runVirtual signal details (non-generator) | ${JSON.stringify(
              {
                cmd,
                hasAbortController: !!this._abortController,
                signalAborted: this._abortController?.signal?.aborted,
                optionsSignalExists: !!this.options.signal,
                optionsSignalAborted: this.options.signal?.aborted,
              },
              null,
              2
            )}`
        );

        const handlerPromise = handler({
          args: argValues,
          stdin: stdinData,
          abortSignal: this._abortController?.signal,
          ...commandOptions,
        });

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
            const exitCode = this._cancellationSignal === 'SIGINT' ? 130 : 143;
            trace(
              'ProcessRunner',
              () =>
                `Virtual command cancelled with signal ${this._cancellationSignal}, exit code: ${exitCode}`
            );
            result = {
              code: exitCode,
              stdout: '',
              stderr: '',
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
          stdin: this.options.capture ? stdinData : undefined,
        };

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
      let exitCode = error.code ?? 1;
      if (this._cancelled && this._cancellationSignal) {
        exitCode =
          this._cancellationSignal === 'SIGINT'
            ? 130
            : this._cancellationSignal === 'SIGTERM'
              ? 143
              : 1;
        trace(
          'ProcessRunner',
          () =>
            `Virtual command error during cancellation, using signal-based exit code: ${exitCode}`
        );
      }

      const result = {
        code: exitCode,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        stdin: '',
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
  };
}
