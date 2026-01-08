// ProcessRunner execution methods - start, sync, async, and related methods
// Part of the modular ProcessRunner architecture

import cp from 'child_process';
import { trace } from './$.trace.mjs';
import { findAvailableShell } from './$.shell.mjs';
import { StreamUtils, safeWrite, asBuffer } from './$.stream-utils.mjs';
import { pumpReadable } from './$.quote.mjs';
import { createResult } from './$.result.mjs';
import { parseShellCommand, needsRealShell } from './shell-parser.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Attach execution methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies (virtualCommands, globalShellSettings, isVirtualCommandsEnabled)
 */
export function attachExecutionMethods(ProcessRunner, deps) {
  const { virtualCommands, globalShellSettings, isVirtualCommandsEnabled } =
    deps;

  // Unified start method
  ProcessRunner.prototype.start = function (options = {}) {
    const mode = options.mode || 'async';

    trace(
      'ProcessRunner',
      () =>
        `start ENTER | ${JSON.stringify(
          {
            mode,
            options,
            started: this.started,
            hasPromise: !!this.promise,
            hasChild: !!this.child,
            command: this.spec?.command?.slice(0, 50),
          },
          null,
          2
        )}`
    );

    if (Object.keys(options).length > 0 && !this.started) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: options => MERGE | ${JSON.stringify(
            {
              oldOptions: this.options,
              newOptions: options,
            },
            null,
            2
          )}`
      );

      this.options = { ...this.options, ...options };

      if (
        this.options.signal &&
        typeof this.options.signal.addEventListener === 'function'
      ) {
        trace(
          'ProcessRunner',
          () =>
            `Setting up external abort signal listener | ${JSON.stringify(
              {
                hasSignal: !!this.options.signal,
                signalAborted: this.options.signal.aborted,
                hasInternalController: !!this._abortController,
                internalAborted: this._abortController?.signal.aborted,
              },
              null,
              2
            )}`
        );

        this.options.signal.addEventListener('abort', () => {
          trace(
            'ProcessRunner',
            () =>
              `External abort signal triggered | ${JSON.stringify(
                {
                  externalSignalAborted: this.options.signal.aborted,
                  hasInternalController: !!this._abortController,
                  internalAborted: this._abortController?.signal.aborted,
                  command: this.spec?.command?.slice(0, 50),
                },
                null,
                2
              )}`
          );

          this.kill('SIGTERM');
          trace(
            'ProcessRunner',
            () => 'Process kill initiated due to external abort signal'
          );

          if (this._abortController && !this._abortController.signal.aborted) {
            trace(
              'ProcessRunner',
              () => 'Aborting internal controller due to external signal'
            );
            this._abortController.abort();
          }
        });

        if (this.options.signal.aborted) {
          trace(
            'ProcessRunner',
            () =>
              `External signal already aborted, killing process and aborting internal controller`
          );

          this.kill('SIGTERM');

          if (this._abortController && !this._abortController.signal.aborted) {
            this._abortController.abort();
          }
        }
      }

      if ('capture' in options) {
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: capture => REINIT_CHUNKS | ${JSON.stringify(
              {
                capture: this.options.capture,
              },
              null,
              2
            )}`
        );

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
      }

      trace(
        'ProcessRunner',
        () =>
          `OPTIONS_MERGED | ${JSON.stringify(
            {
              finalOptions: this.options,
            },
            null,
            2
          )}`
      );
    }

    if (mode === 'sync') {
      trace(
        'ProcessRunner',
        () => `BRANCH: mode => sync | ${JSON.stringify({}, null, 2)}`
      );
      return this._startSync();
    } else {
      trace(
        'ProcessRunner',
        () => `BRANCH: mode => async | ${JSON.stringify({}, null, 2)}`
      );
      return this._startAsync();
    }
  };

  ProcessRunner.prototype.sync = function () {
    return this.start({ mode: 'sync' });
  };

  ProcessRunner.prototype.async = function () {
    return this.start({ mode: 'async' });
  };

  ProcessRunner.prototype.run = function (options = {}) {
    trace(
      'ProcessRunner',
      () => `run ENTER | ${JSON.stringify({ options }, null, 2)}`
    );
    return this.start(options);
  };

  ProcessRunner.prototype._startAsync = async function () {
    if (this.started) {
      return this.promise;
    }
    if (this.promise) {
      return this.promise;
    }

    this.promise = this._doStartAsync();
    return this.promise;
  };

  ProcessRunner.prototype._doStartAsync = async function () {
    trace(
      'ProcessRunner',
      () =>
        `_doStartAsync ENTER | ${JSON.stringify(
          {
            mode: this.spec.mode,
            command: this.spec.command?.slice(0, 100),
          },
          null,
          2
        )}`
    );

    this.started = true;
    this._mode = 'async';

    try {
      const { cwd, env, stdin } = this.options;

      if (this.spec.mode === 'pipeline') {
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: spec.mode => pipeline | ${JSON.stringify(
              {
                hasSource: !!this.spec.source,
                hasDestination: !!this.spec.destination,
              },
              null,
              2
            )}`
        );
        return await this._runProgrammaticPipeline(
          this.spec.source,
          this.spec.destination
        );
      }

      if (this.spec.mode === 'shell') {
        trace(
          'ProcessRunner',
          () => `BRANCH: spec.mode => shell | ${JSON.stringify({}, null, 2)}`
        );

        const hasShellOperators =
          this.spec.command.includes('&&') ||
          this.spec.command.includes('||') ||
          this.spec.command.includes('(') ||
          this.spec.command.includes(';') ||
          (this.spec.command.includes('cd ') &&
            this.spec.command.includes('&&'));

        const isStreamingPattern =
          this.spec.command.includes('sleep') &&
          this.spec.command.includes(';') &&
          (this.spec.command.includes('echo') ||
            this.spec.command.includes('printf'));

        const shouldUseShellOperators =
          this.options.shellOperators &&
          hasShellOperators &&
          !isStreamingPattern &&
          !this._isStreaming;

        trace(
          'ProcessRunner',
          () =>
            `Shell operator detection | ${JSON.stringify(
              {
                hasShellOperators,
                shellOperatorsEnabled: this.options.shellOperators,
                isStreamingPattern,
                isStreaming: this._isStreaming,
                shouldUseShellOperators,
                command: this.spec.command.slice(0, 100),
              },
              null,
              2
            )}`
        );

        if (
          !this.options._bypassVirtual &&
          shouldUseShellOperators &&
          !needsRealShell(this.spec.command)
        ) {
          const enhancedParsed = parseShellCommand(this.spec.command);
          if (enhancedParsed && enhancedParsed.type !== 'simple') {
            trace(
              'ProcessRunner',
              () =>
                `Using enhanced parser for shell operators | ${JSON.stringify(
                  {
                    type: enhancedParsed.type,
                    command: this.spec.command.slice(0, 50),
                  },
                  null,
                  2
                )}`
            );

            if (enhancedParsed.type === 'sequence') {
              return await this._runSequence(enhancedParsed);
            } else if (enhancedParsed.type === 'subshell') {
              return await this._runSubshell(enhancedParsed);
            } else if (enhancedParsed.type === 'pipeline') {
              return await this._runPipeline(enhancedParsed.commands);
            }
          }
        }

        const parsed = this._parseCommand(this.spec.command);
        trace(
          'ProcessRunner',
          () =>
            `Parsed command | ${JSON.stringify(
              {
                type: parsed?.type,
                cmd: parsed?.cmd,
                argsCount: parsed?.args?.length,
              },
              null,
              2
            )}`
        );

        if (parsed) {
          if (parsed.type === 'pipeline') {
            trace(
              'ProcessRunner',
              () =>
                `BRANCH: parsed.type => pipeline | ${JSON.stringify(
                  {
                    commandCount: parsed.commands?.length,
                  },
                  null,
                  2
                )}`
            );
            return await this._runPipeline(parsed.commands);
          } else if (
            parsed.type === 'simple' &&
            isVirtualCommandsEnabled() &&
            virtualCommands.has(parsed.cmd) &&
            !this.options._bypassVirtual
          ) {
            const hasCustomStdin =
              this.options.stdin &&
              this.options.stdin !== 'inherit' &&
              this.options.stdin !== 'ignore';

            const commandsThatNeedRealStdin = ['sleep', 'cat'];
            const shouldBypassVirtual =
              hasCustomStdin && commandsThatNeedRealStdin.includes(parsed.cmd);

            if (shouldBypassVirtual) {
              trace(
                'ProcessRunner',
                () =>
                  `Bypassing built-in virtual command due to custom stdin | ${JSON.stringify(
                    {
                      cmd: parsed.cmd,
                      stdin: typeof this.options.stdin,
                    },
                    null,
                    2
                  )}`
              );
            } else {
              trace(
                'ProcessRunner',
                () =>
                  `BRANCH: virtualCommand => ${parsed.cmd} | ${JSON.stringify(
                    {
                      isVirtual: true,
                      args: parsed.args,
                    },
                    null,
                    2
                  )}`
              );
              return await this._runVirtual(
                parsed.cmd,
                parsed.args,
                this.spec.command
              );
            }
          }
        }
      }

      const shell = findAvailableShell();
      const argv =
        this.spec.mode === 'shell'
          ? [shell.cmd, ...shell.args, this.spec.command]
          : [this.spec.file, ...this.spec.args];

      trace(
        'ProcessRunner',
        () =>
          `Constructed argv | ${JSON.stringify(
            {
              mode: this.spec.mode,
              argv,
              originalCommand: this.spec.command,
            },
            null,
            2
          )}`
      );

      if (globalShellSettings.xtrace) {
        const traceCmd =
          this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
        console.log(`+ ${traceCmd}`);
      }

      if (globalShellSettings.verbose) {
        const verboseCmd =
          this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
        console.log(verboseCmd);
      }

      const isInteractive =
        stdin === 'inherit' &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true &&
        process.stderr.isTTY === true &&
        this.options.interactive === true;

      trace(
        'ProcessRunner',
        () =>
          `Interactive command detection | ${JSON.stringify(
            {
              isInteractive,
              stdinInherit: stdin === 'inherit',
              stdinTTY: process.stdin.isTTY,
              stdoutTTY: process.stdout.isTTY,
              stderrTTY: process.stderr.isTTY,
              interactiveOption: this.options.interactive,
            },
            null,
            2
          )}`
      );

      const spawnBun = (argv) => {
        trace(
          'ProcessRunner',
          () =>
            `spawnBun: Creating process | ${JSON.stringify(
              {
                command: argv[0],
                args: argv.slice(1),
                isInteractive,
                cwd,
                platform: process.platform,
              },
              null,
              2
            )}`
        );

        if (isInteractive) {
          trace(
            'ProcessRunner',
            () => `spawnBun: Using interactive mode with inherited stdio`
          );
          const child = Bun.spawn(argv, {
            cwd,
            env,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
          });
          return child;
        }

        trace(
          'ProcessRunner',
          () =>
            `spawnBun: Using non-interactive mode with pipes and detached=${process.platform !== 'win32'}`
        );

        const child = Bun.spawn(argv, {
          cwd,
          env,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          detached: process.platform !== 'win32',
        });
        return child;
      };

      const spawnNode = async (argv) => {
        trace(
          'ProcessRunner',
          () =>
            `spawnNode: Creating process | ${JSON.stringify({
              command: argv[0],
              args: argv.slice(1),
              isInteractive,
              cwd,
              platform: process.platform,
            })}`
        );

        if (isInteractive) {
          return cp.spawn(argv[0], argv.slice(1), {
            cwd,
            env,
            stdio: 'inherit',
          });
        }

        const child = cp.spawn(argv[0], argv.slice(1), {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });

        trace(
          'ProcessRunner',
          () =>
            `spawnNode: Process created | ${JSON.stringify({
              pid: child.pid,
              killed: child.killed,
              hasStdout: !!child.stdout,
              hasStderr: !!child.stderr,
              hasStdin: !!child.stdin,
            })}`
        );

        return child;
      };

      const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
      const preferNodeForInput = isBun && needsExplicitPipe;

      trace(
        'ProcessRunner',
        () =>
          `About to spawn process | ${JSON.stringify(
            {
              needsExplicitPipe,
              preferNodeForInput,
              runtime: isBun ? 'Bun' : 'Node',
              command: argv[0],
              args: argv.slice(1),
            },
            null,
            2
          )}`
      );

      this.child = preferNodeForInput
        ? await spawnNode(argv)
        : isBun
          ? spawnBun(argv)
          : await spawnNode(argv);

      if (this.child) {
        trace(
          'ProcessRunner',
          () =>
            `Child process created | ${JSON.stringify(
              {
                pid: this.child.pid,
                detached: this.child.options?.detached,
                killed: this.child.killed,
                hasStdout: !!this.child.stdout,
                hasStderr: !!this.child.stderr,
                hasStdin: !!this.child.stdin,
                platform: process.platform,
                command: this.spec?.command?.slice(0, 100),
              },
              null,
              2
            )}`
        );

        if (this.child && typeof this.child.on === 'function') {
          this.child.on('spawn', () => {
            trace(
              'ProcessRunner',
              () =>
                `Child process spawned successfully | ${JSON.stringify(
                  {
                    pid: this.child.pid,
                    command: this.spec?.command?.slice(0, 50),
                  },
                  null,
                  2
                )}`
            );
          });

          this.child.on('error', (error) => {
            trace(
              'ProcessRunner',
              () =>
                `Child process error event | ${JSON.stringify(
                  {
                    pid: this.child?.pid,
                    error: error.message,
                    code: error.code,
                    errno: error.errno,
                    syscall: error.syscall,
                    command: this.spec?.command?.slice(0, 50),
                  },
                  null,
                  2
                )}`
            );
          });
        }
      }

      const childPid = this.child?.pid;

      const outPump = this.child.stdout
        ? pumpReadable(this.child.stdout, async (buf) => {
            trace(
              'ProcessRunner',
              () =>
                `stdout data received | ${JSON.stringify({
                  pid: childPid,
                  bufferLength: buf.length,
                  capture: this.options.capture,
                  mirror: this.options.mirror,
                  preview: buf.toString().slice(0, 100),
                })}`
            );

            if (this.options.capture) {
              this.outChunks.push(buf);
            }
            if (this.options.mirror) {
              safeWrite(process.stdout, buf);
            }

            this._emitProcessedData('stdout', buf);
          })
        : Promise.resolve();

      const errPump = this.child.stderr
        ? pumpReadable(this.child.stderr, async (buf) => {
            trace(
              'ProcessRunner',
              () =>
                `stderr data received | ${JSON.stringify({
                  pid: childPid,
                  bufferLength: buf.length,
                  capture: this.options.capture,
                  mirror: this.options.mirror,
                  preview: buf.toString().slice(0, 100),
                })}`
            );

            if (this.options.capture) {
              this.errChunks.push(buf);
            }
            if (this.options.mirror) {
              safeWrite(process.stderr, buf);
            }

            this._emitProcessedData('stderr', buf);
          })
        : Promise.resolve();

      let stdinPumpPromise = Promise.resolve();

      trace(
        'ProcessRunner',
        () =>
          `Setting up stdin handling | ${JSON.stringify(
            {
              stdinType: typeof stdin,
              stdin:
                stdin === 'inherit'
                  ? 'inherit'
                  : stdin === 'ignore'
                    ? 'ignore'
                    : typeof stdin === 'string'
                      ? `string(${stdin.length})`
                      : 'other',
              isInteractive,
              hasChildStdin: !!this.child?.stdin,
              processTTY: process.stdin.isTTY,
            },
            null,
            2
          )}`
      );

      if (stdin === 'inherit') {
        if (isInteractive) {
          trace(
            'ProcessRunner',
            () => `stdin: Using inherit mode for interactive command`
          );
          stdinPumpPromise = Promise.resolve();
        } else {
          const isPipedIn = process.stdin && process.stdin.isTTY === false;
          trace(
            'ProcessRunner',
            () =>
              `stdin: Non-interactive inherit mode | ${JSON.stringify(
                {
                  isPipedIn,
                  stdinTTY: process.stdin.isTTY,
                },
                null,
                2
              )}`
          );
          if (isPipedIn) {
            trace(
              'ProcessRunner',
              () => `stdin: Pumping piped input to child process`
            );
            stdinPumpPromise = this._pumpStdinTo(
              this.child,
              this.options.capture ? this.inChunks : null
            );
          } else {
            trace(
              'ProcessRunner',
              () => `stdin: Forwarding TTY stdin for non-interactive command`
            );
            stdinPumpPromise = this._forwardTTYStdin();
          }
        }
      } else if (stdin === 'ignore') {
        trace('ProcessRunner', () => `stdin: Ignoring and closing stdin`);
        if (this.child.stdin && typeof this.child.stdin.end === 'function') {
          this.child.stdin.end();
        }
      } else if (stdin === 'pipe') {
        trace(
          'ProcessRunner',
          () => `stdin: Using pipe mode - leaving stdin open for manual control`
        );
        stdinPumpPromise = Promise.resolve();
      } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
        const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
        trace(
          'ProcessRunner',
          () =>
            `stdin: Writing buffer to child | ${JSON.stringify(
              {
                bufferLength: buf.length,
                willCapture: this.options.capture && !!this.inChunks,
              },
              null,
              2
            )}`
        );
        if (this.options.capture && this.inChunks) {
          this.inChunks.push(Buffer.from(buf));
        }
        stdinPumpPromise = this._writeToStdin(buf);
      }

      const exited = isBun
        ? this.child.exited
        : new Promise((resolve) => {
            trace(
              'ProcessRunner',
              () =>
                `Setting up child process event listeners for PID ${this.child.pid}`
            );
            this.child.on('close', (code, signal) => {
              trace(
                'ProcessRunner',
                () =>
                  `Child process close event | ${JSON.stringify(
                    {
                      pid: this.child.pid,
                      code,
                      signal,
                      killed: this.child.killed,
                      exitCode: this.child.exitCode,
                      signalCode: this.child.signalCode,
                      command: this.command,
                    },
                    null,
                    2
                  )}`
              );
              resolve(code);
            });
            this.child.on('exit', (code, signal) => {
              trace(
                'ProcessRunner',
                () =>
                  `Child process exit event | ${JSON.stringify(
                    {
                      pid: this.child.pid,
                      code,
                      signal,
                      killed: this.child.killed,
                      exitCode: this.child.exitCode,
                      signalCode: this.child.signalCode,
                      command: this.command,
                    },
                    null,
                    2
                  )}`
              );
            });
          });

      const code = await exited;
      await Promise.all([outPump, errPump, stdinPumpPromise]);

      trace(
        'ProcessRunner',
        () =>
          `Raw exit code from child | ${JSON.stringify(
            {
              code,
              codeType: typeof code,
              childExitCode: this.child?.exitCode,
              isBun,
            },
            null,
            2
          )}`
      );

      let finalExitCode = code;

      if (finalExitCode === undefined || finalExitCode === null) {
        if (this._cancelled) {
          finalExitCode = 143;
          trace(
            'ProcessRunner',
            () => `Process was killed, using SIGTERM exit code 143`
          );
        } else {
          finalExitCode = 0;
          trace(
            'ProcessRunner',
            () => `Process exited without code, defaulting to 0`
          );
        }
      }

      const resultData = {
        code: finalExitCode,
        stdout: this.options.capture
          ? this.outChunks && this.outChunks.length > 0
            ? Buffer.concat(this.outChunks).toString('utf8')
            : ''
          : undefined,
        stderr: this.options.capture
          ? this.errChunks && this.errChunks.length > 0
            ? Buffer.concat(this.errChunks).toString('utf8')
            : ''
          : undefined,
        stdin:
          this.options.capture && this.inChunks
            ? Buffer.concat(this.inChunks).toString('utf8')
            : undefined,
        child: this.child,
      };

      trace(
        'ProcessRunner',
        () =>
          `Process completed | ${JSON.stringify(
            {
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
              runtime: isBun ? 'Bun' : 'Node.js',
            },
            null,
            2
          )}`
      );

      const result = {
        ...resultData,
        async text() {
          return resultData.stdout || '';
        },
      };

      this.finish(result);

      trace(
        'ProcessRunner',
        () =>
          `Process finished, result set | ${JSON.stringify(
            {
              finished: this.finished,
              resultCode: this.result?.code,
            },
            null,
            2
          )}`
      );

      if (globalShellSettings.errexit && this.result.code !== 0) {
        trace(
          'ProcessRunner',
          () =>
            `Errexit mode: throwing error for non-zero exit code | ${JSON.stringify(
              {
                exitCode: this.result.code,
                errexit: globalShellSettings.errexit,
                hasStdout: !!this.result.stdout,
                hasStderr: !!this.result.stderr,
              },
              null,
              2
            )}`
        );

        const error = new Error(
          `Command failed with exit code ${this.result.code}`
        );
        error.code = this.result.code;
        error.stdout = this.result.stdout;
        error.stderr = this.result.stderr;
        error.result = this.result;

        throw error;
      }

      return this.result;
    } catch (error) {
      trace(
        'ProcessRunner',
        () =>
          `Caught error in _doStartAsync | ${JSON.stringify(
            {
              errorMessage: error.message,
              errorCode: error.code,
              isCommandError: error.isCommandError,
              hasResult: !!error.result,
              command: this.spec?.command?.slice(0, 100),
            },
            null,
            2
          )}`
      );

      if (!this.finished) {
        const errorResult = createResult({
          code: error.code ?? 1,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? error.message ?? '',
          stdin: '',
        });

        this.finish(errorResult);
      }

      throw error;
    }
  };

  ProcessRunner.prototype._pumpStdinTo = async function (child, captureChunks) {
    trace(
      'ProcessRunner',
      () =>
        `_pumpStdinTo ENTER | ${JSON.stringify(
          {
            hasChildStdin: !!child?.stdin,
            willCapture: !!captureChunks,
            isBun,
          },
          null,
          2
        )}`
    );

    if (!child.stdin) {
      trace('ProcessRunner', () => 'No child stdin to pump to');
      return;
    }

    const bunWriter =
      isBun && child.stdin && typeof child.stdin.getWriter === 'function'
        ? child.stdin.getWriter()
        : null;

    for await (const chunk of process.stdin) {
      const buf = asBuffer(chunk);
      captureChunks && captureChunks.push(buf);
      if (bunWriter) {
        await bunWriter.write(buf);
      } else if (typeof child.stdin.write === 'function') {
        StreamUtils.addStdinErrorHandler(child.stdin, 'child stdin buffer');
        StreamUtils.safeStreamWrite(child.stdin, buf, 'child stdin buffer');
      } else if (isBun && typeof Bun.write === 'function') {
        await Bun.write(child.stdin, buf);
      }
    }

    if (bunWriter) {
      await bunWriter.close();
    } else if (typeof child.stdin.end === 'function') {
      child.stdin.end();
    }
  };

  ProcessRunner.prototype._writeToStdin = async function (buf) {
    trace(
      'ProcessRunner',
      () =>
        `_writeToStdin ENTER | ${JSON.stringify(
          {
            bufferLength: buf?.length || 0,
            hasChildStdin: !!this.child?.stdin,
          },
          null,
          2
        )}`
    );

    const bytes =
      buf instanceof Uint8Array
        ? buf
        : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);

    if (await StreamUtils.writeToStream(this.child.stdin, bytes, 'stdin')) {
      if (StreamUtils.isBunStream(this.child.stdin)) {
        // Stream was already closed by writeToStream utility - no action needed
      } else if (StreamUtils.isNodeStream(this.child.stdin)) {
        try {
          this.child.stdin.end();
        } catch (_endError) {
          /* Expected when stream is already closed */
        }
      }
    } else if (isBun && typeof Bun.write === 'function') {
      await Bun.write(this.child.stdin, buf);
    }
  };

  ProcessRunner.prototype._forwardTTYStdin = async function () {
    trace(
      'ProcessRunner',
      () =>
        `_forwardTTYStdin ENTER | ${JSON.stringify(
          {
            isTTY: process.stdin.isTTY,
            hasChildStdin: !!this.child?.stdin,
          },
          null,
          2
        )}`
    );

    if (!process.stdin.isTTY || !this.child.stdin) {
      trace(
        'ProcessRunner',
        () => 'TTY forwarding skipped - no TTY or no child stdin'
      );
      return;
    }

    try {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onData = (chunk) => {
        if (chunk[0] === 3) {
          trace(
            'ProcessRunner',
            () => 'CTRL+C detected, sending SIGINT to child process'
          );
          this._sendSigintToChild();
          return;
        }

        if (this.child.stdin) {
          if (isBun && this.child.stdin.write) {
            this.child.stdin.write(chunk);
          } else if (this.child.stdin.write) {
            this.child.stdin.write(chunk);
          }
        }
      };

      const cleanup = () => {
        trace(
          'ProcessRunner',
          () => 'TTY stdin cleanup - restoring terminal mode'
        );
        process.stdin.removeListener('data', onData);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      };

      process.stdin.on('data', onData);

      const childExit = isBun
        ? this.child.exited
        : new Promise((resolve) => {
            this.child.once('close', resolve);
            this.child.once('exit', resolve);
          });

      childExit.then(cleanup).catch(cleanup);

      return childExit;
    } catch (error) {
      trace(
        'ProcessRunner',
        () =>
          `TTY stdin forwarding error | ${JSON.stringify({ error: error.message }, null, 2)}`
      );
    }
  };

  // Helper to send SIGINT to child process - reduces nesting depth
  ProcessRunner.prototype._sendSigintToChild = function () {
    if (!this.child || !this.child.pid) {
      return;
    }
    try {
      if (isBun) {
        this.child.kill('SIGINT');
      } else if (this.child.pid > 0) {
        try {
          process.kill(-this.child.pid, 'SIGINT');
        } catch (_groupErr) {
          process.kill(this.child.pid, 'SIGINT');
        }
      }
    } catch (err) {
      trace('ProcessRunner', () => `Error sending SIGINT: ${err.message}`);
    }
  };

  ProcessRunner.prototype._parseCommand = function (command) {
    trace(
      'ProcessRunner',
      () =>
        `_parseCommand ENTER | ${JSON.stringify(
          {
            commandLength: command?.length || 0,
            preview: command?.slice(0, 50),
          },
          null,
          2
        )}`
    );

    const trimmed = command.trim();
    if (!trimmed) {
      trace('ProcessRunner', () => 'Empty command after trimming');
      return null;
    }

    if (trimmed.includes('|')) {
      return this._parsePipeline(trimmed);
    }

    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (parts.length === 0) {
      return null;
    }

    const cmd = parts[0];
    const args = parts.slice(1).map((arg) => {
      if (
        (arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))
      ) {
        return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
      }
      return { value: arg, quoted: false };
    });

    return { cmd, args, type: 'simple' };
  };

  ProcessRunner.prototype._parsePipeline = function (command) {
    trace(
      'ProcessRunner',
      () =>
        `_parsePipeline ENTER | ${JSON.stringify(
          {
            commandLength: command?.length || 0,
            hasPipe: command?.includes('|'),
          },
          null,
          2
        )}`
    );

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

    const commands = segments
      .map((segment) => {
        const parts = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        if (parts.length === 0) {
          return null;
        }

        const cmd = parts[0];
        const args = parts.slice(1).map((arg) => {
          if (
            (arg.startsWith('"') && arg.endsWith('"')) ||
            (arg.startsWith("'") && arg.endsWith("'"))
          ) {
            return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
          }
          return { value: arg, quoted: false };
        });

        return { cmd, args };
      })
      .filter(Boolean);

    return { type: 'pipeline', commands };
  };

  // Sync execution
  ProcessRunner.prototype._startSync = function () {
    trace(
      'ProcessRunner',
      () =>
        `_startSync ENTER | ${JSON.stringify(
          {
            started: this.started,
            spec: this.spec,
          },
          null,
          2
        )}`
    );

    if (this.started) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: _startSync => ALREADY_STARTED | ${JSON.stringify({}, null, 2)}`
      );
      throw new Error(
        'Command already started - cannot run sync after async start'
      );
    }

    this.started = true;
    this._mode = 'sync';

    const { cwd, env, stdin } = this.options;
    const shell = findAvailableShell();
    const argv =
      this.spec.mode === 'shell'
        ? [shell.cmd, ...shell.args, this.spec.command]
        : [this.spec.file, ...this.spec.args];

    if (globalShellSettings.xtrace) {
      const traceCmd =
        this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
    }

    if (globalShellSettings.verbose) {
      const verboseCmd =
        this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
    }

    let result;

    if (isBun) {
      const proc = Bun.spawnSync(argv, {
        cwd,
        env,
        stdin:
          typeof stdin === 'string'
            ? Buffer.from(stdin)
            : Buffer.isBuffer(stdin)
              ? stdin
              : stdin === 'ignore'
                ? undefined
                : undefined,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      result = createResult({
        code: proc.exitCode || 0,
        stdout: proc.stdout?.toString('utf8') || '',
        stderr: proc.stderr?.toString('utf8') || '',
        stdin:
          typeof stdin === 'string'
            ? stdin
            : Buffer.isBuffer(stdin)
              ? stdin.toString('utf8')
              : '',
      });
      result.child = proc;
    } else {
      const proc = cp.spawnSync(argv[0], argv.slice(1), {
        cwd,
        env,
        input:
          typeof stdin === 'string'
            ? stdin
            : Buffer.isBuffer(stdin)
              ? stdin
              : undefined,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      result = createResult({
        code: proc.status || 0,
        stdout: proc.stdout || '',
        stderr: proc.stderr || '',
        stdin:
          typeof stdin === 'string'
            ? stdin
            : Buffer.isBuffer(stdin)
              ? stdin.toString('utf8')
              : '',
      });
      result.child = proc;
    }

    if (this.options.mirror) {
      if (result.stdout) {
        safeWrite(process.stdout, result.stdout);
      }
      if (result.stderr) {
        safeWrite(process.stderr, result.stderr);
      }
    }

    this.outChunks = result.stdout ? [Buffer.from(result.stdout)] : [];
    this.errChunks = result.stderr ? [Buffer.from(result.stderr)] : [];

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
  };

  // Promise interface
  ProcessRunner.prototype.then = function (onFulfilled, onRejected) {
    trace(
      'ProcessRunner',
      () =>
        `then() called | ${JSON.stringify(
          {
            hasPromise: !!this.promise,
            started: this.started,
            finished: this.finished,
          },
          null,
          2
        )}`
    );

    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.then(onFulfilled, onRejected);
  };

  ProcessRunner.prototype.catch = function (onRejected) {
    trace(
      'ProcessRunner',
      () =>
        `catch() called | ${JSON.stringify(
          {
            hasPromise: !!this.promise,
            started: this.started,
            finished: this.finished,
          },
          null,
          2
        )}`
    );

    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.catch(onRejected);
  };

  ProcessRunner.prototype.finally = function (onFinally) {
    trace(
      'ProcessRunner',
      () =>
        `finally() called | ${JSON.stringify(
          {
            hasPromise: !!this.promise,
            started: this.started,
            finished: this.finished,
          },
          null,
          2
        )}`
    );

    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.finally(() => {
      if (!this.finished) {
        trace('ProcessRunner', () => 'Finally handler ensuring cleanup');
        const fallbackResult = createResult({
          code: 1,
          stdout: '',
          stderr: 'Process terminated unexpectedly',
          stdin: '',
        });
        this.finish(fallbackResult);
      }
      if (onFinally) {
        onFinally();
      }
    });
  };
}
