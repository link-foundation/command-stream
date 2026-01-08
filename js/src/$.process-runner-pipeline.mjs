// ProcessRunner Pipeline Methods - pipeline execution and related methods
// This module adds pipeline-related methods to ProcessRunner.prototype

/**
 * Extend ProcessRunner with pipeline methods
 * @param {Function} ProcessRunner - The ProcessRunner class to extend
 * @param {object} deps - Dependencies (isBun, findAvailableShell, etc.)
 */
export function extendWithPipelineMethods(ProcessRunner, deps) {
  const {
    isBun,
    findAvailableShell,
    createResult,
    StreamUtils,
    safeWrite,
    trace,
    virtualCommands,
    isVirtualCommandsEnabled,
    getShellSettings,
  } = deps;

  // Run programmatic pipeline (.pipe() method)
  ProcessRunner.prototype._runProgrammaticPipeline = async function (
    source,
    destination
  ) {
    trace(
      'ProcessRunner',
      () => `_runProgrammaticPipeline ENTER | ${JSON.stringify({}, null, 2)}`
    );

    try {
      trace('ProcessRunner', () => 'Executing source command');
      const sourceResult = await source;

      if (sourceResult.code !== 0) {
        return sourceResult;
      }

      const destWithStdin = new ProcessRunner(destination.spec, {
        ...destination.options,
        stdin: sourceResult.stdout,
      });

      const destResult = await destWithStdin;

      return createResult({
        code: destResult.code,
        stdout: destResult.stdout,
        stderr: sourceResult.stderr + destResult.stderr,
        stdin: sourceResult.stdin,
      });
    } catch (error) {
      const result = createResult({
        code: error.code ?? 1,
        stdout: '',
        stderr: error.message || 'Pipeline execution failed',
        stdin:
          this.options.stdin && typeof this.options.stdin === 'string'
            ? this.options.stdin
            : this.options.stdin && Buffer.isBuffer(this.options.stdin)
              ? this.options.stdin.toString('utf8')
              : '',
      });

      const buf = Buffer.from(result.stderr);
      if (this.options.mirror) {
        safeWrite(process.stderr, buf);
      }
      this._emitProcessedData('stderr', buf);

      this.finish(result);

      return result;
    }
  };

  ProcessRunner.prototype._runPipeline = async function (commands) {
    trace(
      'ProcessRunner',
      () => `_runPipeline ENTER | commandsCount: ${commands.length}`
    );

    if (commands.length === 0) {
      return createResult({
        code: 1,
        stdout: '',
        stderr: 'No commands in pipeline',
        stdin: '',
      });
    }

    // For true streaming, we need to connect processes via pipes
    if (isBun) {
      return this._runStreamingPipelineBun(commands);
    }

    // For Node.js, fall back to non-streaming implementation for now
    return this._runPipelineNonStreaming(commands);
  };

  ProcessRunner.prototype._runStreamingPipelineBun = async function (commands) {
    const virtualCommandsEnabled = isVirtualCommandsEnabled();
    const globalShellSettings = getShellSettings();

    trace(
      'ProcessRunner',
      () => `_runStreamingPipelineBun ENTER | commandsCount: ${commands.length}`
    );

    // Analyze the pipeline to identify virtual vs real commands
    const pipelineInfo = commands.map((command) => {
      const { cmd } = command;
      const isVirtual = virtualCommandsEnabled && virtualCommands.has(cmd);
      return { ...command, isVirtual };
    });

    // If pipeline contains virtual commands, use advanced streaming
    if (pipelineInfo.some((info) => info.isVirtual)) {
      return this._runMixedStreamingPipeline(commands);
    }

    // For pipelines with commands that buffer, use tee streaming
    const needsStreamingWorkaround = commands.some(
      (c) =>
        c.cmd === 'jq' ||
        c.cmd === 'grep' ||
        c.cmd === 'sed' ||
        c.cmd === 'cat' ||
        c.cmd === 'awk'
    );

    if (needsStreamingWorkaround) {
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
          if (
            typeof arg === 'string' &&
            arg.includes(' ') &&
            !arg.startsWith('"') &&
            !arg.startsWith("'")
          ) {
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
        stdin = processes[i - 1].stdout;
      }

      const needsShell =
        commandStr.includes('*') ||
        commandStr.includes('$') ||
        commandStr.includes('>') ||
        commandStr.includes('<') ||
        commandStr.includes('&&') ||
        commandStr.includes('||') ||
        commandStr.includes(';') ||
        commandStr.includes('`');

      const shell = findAvailableShell();
      const spawnArgs = needsShell
        ? [shell.cmd, ...shell.args.filter((arg) => arg !== '-l'), commandStr]
        : [cmd, ...args.map((a) => (a.value !== undefined ? a.value : a))];

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Write stdin data if needed for first process
      if (needsManualStdin && stdinData && proc.stdin) {
        const stdinHandler = StreamUtils.setupStdinHandling(
          proc.stdin,
          'Bun process stdin'
        );

        (async () => {
          try {
            if (stdinHandler.isWritable()) {
              await proc.stdin.write(stdinData);
              await proc.stdin.end();
            }
          } catch (e) {
            if (e.code !== 'EPIPE') {
              trace(
                'ProcessRunner',
                () => `Error with Bun stdin async operations | ${e.message}`
              );
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

    for await (const chunk of lastProc.stdout) {
      const buf = Buffer.from(chunk);
      finalOutput += buf.toString();
      if (this.options.mirror) {
        safeWrite(process.stdout, buf);
      }
      this._emitProcessedData('stdout', buf);
    }

    // Wait for all processes to complete
    const exitCodes = await Promise.all(processes.map((p) => p.exited));
    const lastExitCode = exitCodes[exitCodes.length - 1];

    if (globalShellSettings.pipefail) {
      const failedIndex = exitCodes.findIndex((code) => code !== 0);
      if (failedIndex !== -1) {
        const error = new Error(
          `Pipeline command at index ${failedIndex} failed with exit code ${exitCodes[failedIndex]}`
        );
        error.code = exitCodes[failedIndex];
        throw error;
      }
    }

    const result = createResult({
      code: lastExitCode || 0,
      stdout: finalOutput,
      stderr: allStderr,
      stdin:
        this.options.stdin && typeof this.options.stdin === 'string'
          ? this.options.stdin
          : this.options.stdin && Buffer.isBuffer(this.options.stdin)
            ? this.options.stdin.toString('utf8')
            : '',
    });

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
  };

  ProcessRunner.prototype._runTeeStreamingPipeline = async function (commands) {
    const globalShellSettings = getShellSettings();

    trace(
      'ProcessRunner',
      () => `_runTeeStreamingPipeline ENTER | commandsCount: ${commands.length}`
    );

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
          if (
            typeof arg === 'string' &&
            arg.includes(' ') &&
            !arg.startsWith('"') &&
            !arg.startsWith("'")
          ) {
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

      const needsShell =
        commandStr.includes('*') ||
        commandStr.includes('$') ||
        commandStr.includes('>') ||
        commandStr.includes('<') ||
        commandStr.includes('&&') ||
        commandStr.includes('||') ||
        commandStr.includes(';') ||
        commandStr.includes('`');

      const shell = findAvailableShell();
      const spawnArgs = needsShell
        ? [shell.cmd, ...shell.args.filter((arg) => arg !== '-l'), commandStr]
        : [cmd, ...args.map((a) => (a.value !== undefined ? a.value : a))];

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Write stdin data if needed for first process
      if (needsManualStdin && stdinData && proc.stdin) {
        const stdinHandler = StreamUtils.setupStdinHandling(
          proc.stdin,
          'Node process stdin'
        );

        try {
          if (stdinHandler.isWritable()) {
            await proc.stdin.write(stdinData);
            await proc.stdin.end();
          }
        } catch (e) {
          if (e.code !== 'EPIPE') {
            trace(
              'ProcessRunner',
              () => `Error with Node stdin async operations | ${e.message}`
            );
          }
        }
      }

      processes.push(proc);

      // For non-last processes, tee the output
      if (i < commands.length - 1) {
        const [readStream, pipeStream] = proc.stdout.tee();
        currentStream = pipeStream;

        // Read from the tee'd stream to keep it flowing
        (async () => {
          for await (const chunk of readStream) {
            // Just consume to keep flowing
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

    for await (const chunk of lastProc.stdout) {
      const buf = Buffer.from(chunk);
      finalOutput += buf.toString();
      if (this.options.mirror) {
        safeWrite(process.stdout, buf);
      }
      this._emitProcessedData('stdout', buf);
    }

    // Wait for all processes to complete
    const exitCodes = await Promise.all(processes.map((p) => p.exited));
    const lastExitCode = exitCodes[exitCodes.length - 1];

    if (globalShellSettings.pipefail) {
      const failedIndex = exitCodes.findIndex((code) => code !== 0);
      if (failedIndex !== -1) {
        const error = new Error(
          `Pipeline command at index ${failedIndex} failed with exit code ${exitCodes[failedIndex]}`
        );
        error.code = exitCodes[failedIndex];
        throw error;
      }
    }

    const result = createResult({
      code: lastExitCode || 0,
      stdout: finalOutput,
      stderr: allStderr,
      stdin:
        this.options.stdin && typeof this.options.stdin === 'string'
          ? this.options.stdin
          : this.options.stdin && Buffer.isBuffer(this.options.stdin)
            ? this.options.stdin.toString('utf8')
            : '',
    });

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
  };

  ProcessRunner.prototype._runMixedStreamingPipeline = async function (
    commands
  ) {
    const virtualCommandsEnabled = isVirtualCommandsEnabled();

    trace(
      'ProcessRunner',
      () =>
        `_runMixedStreamingPipeline ENTER | commandsCount: ${commands.length}`
    );

    let currentInputStream = null;
    let finalOutput = '';
    let allStderr = '';

    if (this.options.stdin) {
      const inputData =
        typeof this.options.stdin === 'string'
          ? this.options.stdin
          : this.options.stdin.toString('utf8');

      currentInputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(inputData));
          controller.close();
        },
      });
    }

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;
      const isLastCommand = i === commands.length - 1;

      if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
        const handler = virtualCommands.get(cmd);
        const argValues = args.map((arg) =>
          arg.value !== undefined ? arg.value : arg
        );

        // Read input from stream if available
        let inputData = '';
        if (currentInputStream) {
          const reader = currentInputStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              inputData += new TextDecoder().decode(value);
            }
          } finally {
            reader.releaseLock();
          }
        }

        if (handler.constructor.name === 'AsyncGeneratorFunction') {
          const chunks = [];
          const self = this;
          currentInputStream = new ReadableStream({
            async start(controller) {
              const { stdin: _, ...optionsWithoutStdin } = self.options;
              for await (const chunk of handler({
                args: argValues,
                stdin: inputData,
                ...optionsWithoutStdin,
              })) {
                const data = Buffer.from(chunk);
                controller.enqueue(data);

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
            },
          });
        } else {
          // Regular async function
          const { stdin: _, ...optionsWithoutStdin } = this.options;
          const result = await handler({
            args: argValues,
            stdin: inputData,
            ...optionsWithoutStdin,
          });
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
            },
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
            if (
              typeof arg === 'string' &&
              arg.includes(' ') &&
              !arg.startsWith('"') &&
              !arg.startsWith("'")
            ) {
              commandParts.push(`"${arg}"`);
            } else {
              commandParts.push(arg);
            }
          }
        }
        const commandStr = commandParts.join(' ');

        const shell = findAvailableShell();
        const proc = Bun.spawn(
          [shell.cmd, ...shell.args.filter((arg) => arg !== '-l'), commandStr],
          {
            cwd: this.options.cwd,
            env: this.options.env,
            stdin: currentInputStream ? 'pipe' : 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
          }
        );

        // Write input stream to process stdin if needed
        if (currentInputStream && proc.stdin) {
          const reader = currentInputStream.getReader();
          const writer = proc.stdin.getWriter
            ? proc.stdin.getWriter()
            : proc.stdin;

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  break;
                }
                if (writer.write) {
                  try {
                    await writer.write(value);
                  } catch (error) {
                    StreamUtils.handleStreamError(
                      error,
                      'stream writer',
                      false
                    );
                    break;
                  }
                } else if (writer.getWriter) {
                  try {
                    const w = writer.getWriter();
                    await w.write(value);
                    w.releaseLock();
                  } catch (error) {
                    StreamUtils.handleStreamError(
                      error,
                      'stream writer (getWriter)',
                      false
                    );
                    break;
                  }
                }
              }
            } finally {
              reader.releaseLock();
              if (writer.close) {
                await writer.close();
              } else if (writer.end) {
                writer.end();
              }
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
      code: 0,
      stdout: finalOutput,
      stderr: allStderr,
      stdin:
        this.options.stdin && typeof this.options.stdin === 'string'
          ? this.options.stdin
          : this.options.stdin && Buffer.isBuffer(this.options.stdin)
            ? this.options.stdin.toString('utf8')
            : '',
    });

    this.finish(result);

    return result;
  };

  ProcessRunner.prototype._runPipelineNonStreaming = async function (commands) {
    const virtualCommandsEnabled = isVirtualCommandsEnabled();
    const globalShellSettings = getShellSettings();
    const cp = await import('child_process');

    trace(
      'ProcessRunner',
      () => `_runPipelineNonStreaming ENTER | commandsCount: ${commands.length}`
    );

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
        // Run virtual command with current input
        const handler = virtualCommands.get(cmd);

        try {
          const argValues = args.map((arg) =>
            arg.value !== undefined ? arg.value : arg
          );

          if (globalShellSettings.xtrace) {
            console.log(`+ ${cmd} ${argValues.join(' ')}`);
          }
          if (globalShellSettings.verbose) {
            console.log(`${cmd} ${argValues.join(' ')}`);
          }

          let result;

          if (handler.constructor.name === 'AsyncGeneratorFunction') {
            const chunks = [];
            for await (const chunk of handler({
              args: argValues,
              stdin: currentInput,
              ...this.options,
            })) {
              chunks.push(Buffer.from(chunk));
            }
            result = {
              code: 0,
              stdout: this.options.capture
                ? Buffer.concat(chunks).toString('utf8')
                : undefined,
              stderr: this.options.capture ? '' : undefined,
              stdin: this.options.capture ? currentInput : undefined,
            };
          } else {
            result = await handler({
              args: argValues,
              stdin: currentInput,
              ...this.options,
            });
            result = {
              ...result,
              code: result.code ?? 0,
              stdout: this.options.capture ? (result.stdout ?? '') : undefined,
              stderr: this.options.capture ? (result.stderr ?? '') : undefined,
              stdin: this.options.capture ? currentInput : undefined,
            };
          }

          if (i < commands.length - 1) {
            currentInput = result.stdout;
          } else {
            currentOutput = result.stdout;

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
              stdin:
                this.options.stdin && typeof this.options.stdin === 'string'
                  ? this.options.stdin
                  : this.options.stdin && Buffer.isBuffer(this.options.stdin)
                    ? this.options.stdin.toString('utf8')
                    : '',
            });

            this.finish(finalResult);

            if (globalShellSettings.errexit && finalResult.code !== 0) {
              const error = new Error(
                `Pipeline failed with exit code ${finalResult.code}`
              );
              error.code = finalResult.code;
              error.stdout = finalResult.stdout;
              error.stderr = finalResult.stderr;
              error.result = finalResult;
              throw error;
            }

            return finalResult;
          }

          if (globalShellSettings.errexit && result.code !== 0) {
            const error = new Error(
              `Pipeline command failed with exit code ${result.code}`
            );
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
            stdin:
              this.options.stdin && typeof this.options.stdin === 'string'
                ? this.options.stdin
                : this.options.stdin && Buffer.isBuffer(this.options.stdin)
                  ? this.options.stdin.toString('utf8')
                  : '',
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
          const commandParts = [cmd];
          for (const arg of args) {
            if (arg.value !== undefined) {
              if (arg.quoted) {
                commandParts.push(
                  `${arg.quoteChar}${arg.value}${arg.quoteChar}`
                );
              } else if (arg.value.includes(' ')) {
                commandParts.push(`"${arg.value}"`);
              } else {
                commandParts.push(arg.value);
              }
            } else {
              if (
                typeof arg === 'string' &&
                arg.includes(' ') &&
                !arg.startsWith('"') &&
                !arg.startsWith("'")
              ) {
                commandParts.push(`"${arg}"`);
              } else {
                commandParts.push(arg);
              }
            }
          }
          const commandStr = commandParts.join(' ');

          if (globalShellSettings.xtrace) {
            console.log(`+ ${commandStr}`);
          }
          if (globalShellSettings.verbose) {
            console.log(commandStr);
          }

          const spawnNodeAsync = async (argv, stdin, isLastCommand = false) =>
            new Promise((resolve, reject) => {
              const proc = cp.default.spawn(argv[0], argv.slice(1), {
                cwd: this.options.cwd,
                env: this.options.env,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                stdout += chunkStr;

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
                  stderr,
                });
              });

              proc.on('error', reject);

              if (proc.stdin) {
                StreamUtils.addStdinErrorHandler(
                  proc.stdin,
                  'spawnNodeAsync stdin',
                  reject
                );
              }

              if (stdin) {
                StreamUtils.safeStreamWrite(
                  proc.stdin,
                  stdin,
                  'spawnNodeAsync stdin'
                );
              }

              StreamUtils.safeStreamEnd(proc.stdin, 'spawnNodeAsync stdin');
            });

          const shell = findAvailableShell();
          const argv = [
            shell.cmd,
            ...shell.args.filter((arg) => arg !== '-l'),
            commandStr,
          ];
          const isLastCommand = i === commands.length - 1;
          const proc = await spawnNodeAsync(argv, currentInput, isLastCommand);

          const result = {
            code: proc.status || 0,
            stdout: proc.stdout || '',
            stderr: proc.stderr || '',
            stdin: currentInput,
          };

          if (globalShellSettings.pipefail && result.code !== 0) {
            const error = new Error(
              `Pipeline command '${commandStr}' failed with exit code ${result.code}`
            );
            error.code = result.code;
            error.stdout = result.stdout;
            error.stderr = result.stderr;
            throw error;
          }

          if (i < commands.length - 1) {
            currentInput = result.stdout;
            if (result.stderr && this.options.capture) {
              this.errChunks = this.errChunks || [];
              this.errChunks.push(Buffer.from(result.stderr));
            }
          } else {
            currentOutput = result.stdout;

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
              stdin:
                this.options.stdin && typeof this.options.stdin === 'string'
                  ? this.options.stdin
                  : this.options.stdin && Buffer.isBuffer(this.options.stdin)
                    ? this.options.stdin.toString('utf8')
                    : '',
            });

            this.finish(finalResult);

            if (globalShellSettings.errexit && finalResult.code !== 0) {
              const error = new Error(
                `Pipeline failed with exit code ${finalResult.code}`
              );
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
            stdin:
              this.options.stdin && typeof this.options.stdin === 'string'
                ? this.options.stdin
                : this.options.stdin && Buffer.isBuffer(this.options.stdin)
                  ? this.options.stdin.toString('utf8')
                  : '',
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
  };

  ProcessRunner.prototype._runSequence = async function (sequence) {
    trace(
      'ProcessRunner',
      () =>
        `_runSequence ENTER | commandCount: ${sequence.commands.length}, operators: ${sequence.operators}`
    );

    let lastResult = { code: 0, stdout: '', stderr: '' };
    let combinedStdout = '';
    let combinedStderr = '';

    for (let i = 0; i < sequence.commands.length; i++) {
      const command = sequence.commands[i];
      const operator = i > 0 ? sequence.operators[i - 1] : null;

      // Check operator conditions
      if (operator === '&&' && lastResult.code !== 0) {
        continue;
      }
      if (operator === '||' && lastResult.code === 0) {
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

      combinedStdout += lastResult.stdout;
      combinedStderr += lastResult.stderr;
    }

    return {
      code: lastResult.code,
      stdout: combinedStdout,
      stderr: combinedStderr,
      async text() {
        return combinedStdout;
      },
    };
  };

  ProcessRunner.prototype._runSubshell = async function (subshell) {
    const fs = await import('fs');

    trace(
      'ProcessRunner',
      () => `_runSubshell ENTER | commandType: ${subshell.command.type}`
    );

    // Save current directory
    const savedCwd = process.cwd();

    try {
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
      // Restore directory
      if (fs.existsSync(savedCwd)) {
        process.chdir(savedCwd);
      } else {
        const fallbackDir = process.env.HOME || process.env.USERPROFILE || '/';
        try {
          process.chdir(fallbackDir);
        } catch (e) {
          trace(
            'ProcessRunner',
            () => `Failed to restore directory: ${e.message}`
          );
        }
      }
    }
  };

  ProcessRunner.prototype._runSimpleCommand = async function (command) {
    const virtualCommandsEnabled = isVirtualCommandsEnabled();
    const fs = await import('fs');

    trace(
      'ProcessRunner',
      () =>
        `_runSimpleCommand ENTER | cmd: ${command.cmd}, argsCount: ${command.args?.length || 0}`
    );

    const { cmd, args, redirects } = command;

    // Check for virtual command
    if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
      const argValues = args.map((a) => a.value || a);
      const result = await this._runVirtual(cmd, argValues);

      // Handle output redirection for virtual commands
      if (redirects && redirects.length > 0) {
        for (const redirect of redirects) {
          if (redirect.type === '>' || redirect.type === '>>') {
            if (redirect.type === '>') {
              fs.writeFileSync(redirect.target, result.stdout);
            } else {
              fs.appendFileSync(redirect.target, result.stdout);
            }
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

    // Create a new ProcessRunner for the real command
    const runner = new ProcessRunner(
      { mode: 'shell', command: commandStr },
      { ...this.options, cwd: process.cwd(), _bypassVirtual: true }
    );

    return await runner;
  };
}
