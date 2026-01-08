// ProcessRunner Execution Methods - start, sync, async, run, _startAsync, _doStartAsync, _startSync
// This module adds execution-related methods to ProcessRunner.prototype

import cp from 'child_process';
import { parseShellCommand, needsRealShell } from './shell-parser.mjs';

/**
 * Extend ProcessRunner with execution methods
 * @param {Function} ProcessRunner - The ProcessRunner class to extend
 * @param {object} deps - Dependencies (isBun, findAvailableShell, etc.)
 */
export function extendWithExecutionMethods(ProcessRunner, deps) {
  const {
    isBun,
    findAvailableShell,
    createResult,
    StreamUtils,
    safeWrite,
    asBuffer,
    trace,
    virtualCommands,
    isVirtualCommandsEnabled,
    getShellSettings,
    pumpReadable,
  } = deps;

  // Unified start method that can work in both async and sync modes
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

    // Merge new options with existing options before starting
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

      // Create a new options object merging the current ones with the new ones
      this.options = { ...this.options, ...options };

      // Handle external abort signal
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

          // Kill the process when abort signal is triggered
          this.kill('SIGTERM');

          if (this._abortController && !this._abortController.signal.aborted) {
            this._abortController.abort();
          }
        });

        // If the external signal is already aborted, abort immediately
        if (this.options.signal.aborted) {
          this.kill('SIGTERM');
          if (this._abortController && !this._abortController.signal.aborted) {
            this._abortController.abort();
          }
        }
      }

      // Reinitialize chunks based on updated capture option
      if ('capture' in options) {
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
    }

    if (mode === 'sync') {
      return this._startSync();
    } else {
      return this._startAsync();
    }
  };

  // Shortcut for sync mode
  ProcessRunner.prototype.sync = function () {
    return this.start({ mode: 'sync' });
  };

  // Shortcut for async mode
  ProcessRunner.prototype.async = function () {
    return this.start({ mode: 'async' });
  };

  // Alias for start() method
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
    const globalShellSettings = getShellSettings();
    const virtualCommandsEnabled = isVirtualCommandsEnabled();

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

    // Ensure cleanup happens even if execution fails
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

        // Check if shell operator parsing is enabled and command contains operators
        const hasShellOperators =
          this.spec.command.includes('&&') ||
          this.spec.command.includes('||') ||
          this.spec.command.includes('(') ||
          this.spec.command.includes(';') ||
          (this.spec.command.includes('cd ') &&
            this.spec.command.includes('&&'));

        // Intelligent detection: disable shell operators for streaming patterns
        const isStreamingPattern =
          this.spec.command.includes('sleep') &&
          this.spec.command.includes(';') &&
          (this.spec.command.includes('echo') ||
            this.spec.command.includes('printf'));

        // Also check if we're in streaming mode (via .stream() method)
        const shouldUseShellOperators =
          this.options.shellOperators &&
          hasShellOperators &&
          !isStreamingPattern &&
          !this._isStreaming;

        // Only use enhanced parser when appropriate
        if (
          !this.options._bypassVirtual &&
          shouldUseShellOperators &&
          !needsRealShell(this.spec.command)
        ) {
          const enhancedParsed = parseShellCommand(this.spec.command);
          if (enhancedParsed && enhancedParsed.type !== 'simple') {
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

        if (parsed) {
          if (parsed.type === 'pipeline') {
            return await this._runPipeline(parsed.commands);
          } else if (
            parsed.type === 'simple' &&
            virtualCommandsEnabled &&
            virtualCommands.has(parsed.cmd) &&
            !this.options._bypassVirtual
          ) {
            // For built-in virtual commands that have real counterparts (like sleep),
            // skip the virtual version when custom stdin is provided
            const hasCustomStdin =
              this.options.stdin &&
              this.options.stdin !== 'inherit' &&
              this.options.stdin !== 'ignore';

            const commandsThatNeedRealStdin = ['sleep', 'cat'];
            const shouldBypassVirtual =
              hasCustomStdin && commandsThatNeedRealStdin.includes(parsed.cmd);

            if (!shouldBypassVirtual) {
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

      // Detect if this is an interactive command
      const isInteractive =
        stdin === 'inherit' &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true &&
        process.stderr.isTTY === true &&
        this.options.interactive === true;

      const spawnBun = (argv) => {
        if (isInteractive) {
          const child = Bun.spawn(argv, {
            cwd,
            env,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
          });
          return child;
        }
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
        return child;
      };

      const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
      const preferNodeForInput = isBun && needsExplicitPipe;

      this.child = preferNodeForInput
        ? await spawnNode(argv)
        : isBun
          ? spawnBun(argv)
          : await spawnNode(argv);

      // Add event listeners for Node.js child processes
      if (this.child && typeof this.child.on === 'function') {
        this.child.on('spawn', () => {
          trace(
            'ProcessRunner',
            () => `Child process spawned successfully | PID: ${this.child.pid}`
          );
        });

        this.child.on('error', (error) => {
          trace(
            'ProcessRunner',
            () => `Child process error event | ${error.message}`
          );
        });
      }

      // For interactive commands with stdio: 'inherit', stdout/stderr will be null
      const childPid = this.child?.pid;
      const outPump = this.child.stdout
        ? pumpReadable(this.child.stdout, async (buf) => {
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

      if (stdin === 'inherit') {
        if (isInteractive) {
          stdinPumpPromise = Promise.resolve();
        } else {
          const isPipedIn = process.stdin && process.stdin.isTTY === false;
          if (isPipedIn) {
            stdinPumpPromise = this._pumpStdinTo(
              this.child,
              this.options.capture ? this.inChunks : null
            );
          } else {
            stdinPumpPromise = this._forwardTTYStdin();
          }
        }
      } else if (stdin === 'ignore') {
        if (this.child.stdin && typeof this.child.stdin.end === 'function') {
          this.child.stdin.end();
        }
      } else if (stdin === 'pipe') {
        // Leave stdin open for manual writing
        stdinPumpPromise = Promise.resolve();
      } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
        const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
        if (this.options.capture && this.inChunks) {
          this.inChunks.push(Buffer.from(buf));
        }
        stdinPumpPromise = this._writeToStdin(buf);
      }

      const exited = isBun
        ? this.child.exited
        : new Promise((resolve) => {
            this.child.on('close', (code, signal) => {
              resolve(code);
            });
            this.child.on('exit', (code, signal) => {
              // Exit event logged
            });
          });

      const code = await exited;
      await Promise.all([outPump, errPump, stdinPumpPromise]);

      // Handle exit code
      let finalExitCode = code;
      if (finalExitCode === undefined || finalExitCode === null) {
        if (this._cancelled) {
          finalExitCode = 143; // 128 + 15 (SIGTERM)
        } else {
          finalExitCode = 0;
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

      const result = {
        ...resultData,
        async text() {
          return resultData.stdout || '';
        },
      };

      // Finish the process with proper event emission order
      this.finish(result);

      if (globalShellSettings.errexit && this.result.code !== 0) {
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
        () => `Caught error in _doStartAsync | ${error.message}`
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

  ProcessRunner.prototype._forwardTTYStdin = async function () {
    trace(
      'ProcessRunner',
      () =>
        `_forwardTTYStdin ENTER | isTTY: ${process.stdin.isTTY}, hasChildStdin: ${!!this.child?.stdin}`
    );

    if (!process.stdin.isTTY || !this.child.stdin) {
      return;
    }

    try {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onData = (chunk) => {
        if (chunk[0] === 3) {
          // CTRL+C
          if (this.child && this.child.pid) {
            try {
              if (isBun) {
                this.child.kill('SIGINT');
              } else {
                if (this.child.pid > 0) {
                  try {
                    process.kill(-this.child.pid, 'SIGINT');
                  } catch (err) {
                    process.kill(this.child.pid, 'SIGINT');
                  }
                }
              }
            } catch (err) {
              trace(
                'ProcessRunner',
                () => `Error sending SIGINT: ${err.message}`
              );
            }
          }
          return;
        }

        if (this.child.stdin) {
          if (this.child.stdin.write) {
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
        () => `TTY stdin forwarding error | ${error.message}`
      );
    }
  };

  ProcessRunner.prototype._pumpStdinTo = async function (child, captureChunks) {
    trace(
      'ProcessRunner',
      () =>
        `_pumpStdinTo ENTER | hasChildStdin: ${!!child?.stdin}, willCapture: ${!!captureChunks}`
    );

    if (!child.stdin) {
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
        `_writeToStdin ENTER | bufferLength: ${buf?.length || 0}, hasChildStdin: ${!!this.child?.stdin}`
    );

    const bytes =
      buf instanceof Uint8Array
        ? buf
        : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);

    if (await StreamUtils.writeToStream(this.child.stdin, bytes, 'stdin')) {
      if (StreamUtils.isBunStream(this.child.stdin)) {
        // Stream was already closed by writeToStream utility
      } else if (StreamUtils.isNodeStream(this.child.stdin)) {
        try {
          this.child.stdin.end();
        } catch {}
      }
    } else if (isBun && typeof Bun.write === 'function') {
      await Bun.write(this.child.stdin, buf);
    }
  };

  ProcessRunner.prototype._parseCommand = function (command) {
    trace(
      'ProcessRunner',
      () =>
        `_parseCommand ENTER | commandLength: ${command?.length || 0}, preview: ${command?.slice(0, 50)}`
    );

    const trimmed = command.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes('|')) {
      return this._parsePipeline(trimmed);
    }

    // Simple command parsing
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
        `_parsePipeline ENTER | commandLength: ${command?.length || 0}, hasPipe: ${command?.includes('|')}`
    );

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

  // Internal sync execution
  ProcessRunner.prototype._startSync = function () {
    const globalShellSettings = getShellSettings();

    trace(
      'ProcessRunner',
      () =>
        `_startSync ENTER | started: ${this.started}, spec: ${JSON.stringify(this.spec)}`
    );

    if (this.started) {
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
      // Use Bun's synchronous spawn
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
      // Use Node's synchronous spawn
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

    // Mirror output if requested
    if (this.options.mirror) {
      if (result.stdout) {
        safeWrite(process.stdout, result.stdout);
      }
      if (result.stderr) {
        safeWrite(process.stderr, result.stderr);
      }
    }

    // Store chunks for events
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
  };
}
