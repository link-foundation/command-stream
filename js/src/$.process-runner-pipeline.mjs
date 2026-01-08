// ProcessRunner pipeline methods - all pipeline execution strategies
// Part of the modular ProcessRunner architecture

import cp from 'child_process';
import { trace } from './$.trace.mjs';
import { findAvailableShell } from './$.shell.mjs';
import { StreamUtils, safeWrite } from './$.stream-utils.mjs';
import { createResult } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Attach pipeline methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies
 */
export function attachPipelineMethods(ProcessRunner, deps) {
  const { virtualCommands, globalShellSettings, isVirtualCommandsEnabled } =
    deps;

  // Helper to read a stream to string - reduces nesting depth
  ProcessRunner.prototype._readStreamToString = async function (stream) {
    const reader = stream.getReader();
    let result = '';
    try {
      let done = false;
      while (!done) {
        const readResult = await reader.read();
        done = readResult.done;
        if (!done && readResult.value) {
          result += new TextDecoder().decode(readResult.value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return result;
  };

  ProcessRunner.prototype._runStreamingPipelineBun = async function (commands) {
    trace(
      'ProcessRunner',
      () =>
        `_runStreamingPipelineBun ENTER | ${JSON.stringify(
          {
            commandsCount: commands.length,
          },
          null,
          2
        )}`
    );

    const pipelineInfo = commands.map((command) => {
      const { cmd } = command;
      const isVirtual = isVirtualCommandsEnabled() && virtualCommands.has(cmd);
      return { ...command, isVirtual };
    });

    trace(
      'ProcessRunner',
      () =>
        `Pipeline analysis | ${JSON.stringify(
          {
            virtualCount: pipelineInfo.filter((p) => p.isVirtual).length,
            realCount: pipelineInfo.filter((p) => !p.isVirtual).length,
          },
          null,
          2
        )}`
    );

    if (pipelineInfo.some((info) => info.isVirtual)) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: _runStreamingPipelineBun => MIXED_PIPELINE | ${JSON.stringify({}, null, 2)}`
      );
      return this._runMixedStreamingPipeline(commands);
    }

    const needsStreamingWorkaround = commands.some(
      (c) =>
        c.cmd === 'jq' ||
        c.cmd === 'grep' ||
        c.cmd === 'sed' ||
        c.cmd === 'cat' ||
        c.cmd === 'awk'
    );

    if (needsStreamingWorkaround) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: _runStreamingPipelineBun => TEE_STREAMING | ${JSON.stringify(
            {
              bufferedCommands: commands
                .filter((c) =>
                  ['jq', 'grep', 'sed', 'cat', 'awk'].includes(c.cmd)
                )
                .map((c) => c.cmd),
            },
            null,
            2
          )}`
      );
      return this._runTeeStreamingPipeline(commands);
    }

    const processes = [];
    let allStderr = '';

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

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
                () =>
                  `Error with Bun stdin async operations | ${JSON.stringify({ error: e.message, code: e.code }, null, 2)}`
              );
            }
          }
        })();
      }

      processes.push(proc);

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
    trace(
      'ProcessRunner',
      () =>
        `_runTeeStreamingPipeline ENTER | ${JSON.stringify(
          {
            commandsCount: commands.length,
          },
          null,
          2
        )}`
    );

    const processes = [];
    let allStderr = '';
    let currentStream = null;

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

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
              () =>
                `Error with Node stdin async operations | ${JSON.stringify({ error: e.message, code: e.code }, null, 2)}`
            );
          }
        }
      }

      processes.push(proc);

      if (i < commands.length - 1) {
        const [readStream, pipeStream] = proc.stdout.tee();
        currentStream = pipeStream;

        (async () => {
          for await (const chunk of readStream) {
            // Just consume to keep flowing
          }
        })();
      } else {
        currentStream = proc.stdout;
      }

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
    trace(
      'ProcessRunner',
      () =>
        `_runMixedStreamingPipeline ENTER | ${JSON.stringify(
          {
            commandsCount: commands.length,
          },
          null,
          2
        )}`
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

      if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: _runMixedStreamingPipeline => VIRTUAL_COMMAND | ${JSON.stringify(
              {
                cmd,
                commandIndex: i,
              },
              null,
              2
            )}`
        );
        const handler = virtualCommands.get(cmd);
        const argValues = args.map((arg) =>
          arg.value !== undefined ? arg.value : arg
        );

        let inputData = '';
        if (currentInputStream) {
          inputData = await this._readStreamToString(currentInputStream);
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
    trace(
      'ProcessRunner',
      () =>
        `_runPipelineNonStreaming ENTER | ${JSON.stringify(
          {
            commandsCount: commands.length,
          },
          null,
          2
        )}`
    );

    let currentOutput = '';
    let currentInput = '';

    if (this.options.stdin && typeof this.options.stdin === 'string') {
      currentInput = this.options.stdin;
    } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
      currentInput = this.options.stdin.toString('utf8');
    }

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;

      if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: _runPipelineNonStreaming => VIRTUAL_COMMAND | ${JSON.stringify(
              {
                cmd,
                argsCount: args.length,
              },
              null,
              2
            )}`
        );

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
            trace(
              'ProcessRunner',
              () =>
                `BRANCH: _runPipelineNonStreaming => ASYNC_GENERATOR | ${JSON.stringify({ cmd }, null, 2)}`
            );
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
              trace(
                'ProcessRunner',
                () =>
                  `spawnNodeAsync: Creating child process | ${JSON.stringify({
                    command: argv[0],
                    args: argv.slice(1),
                    cwd: this.options.cwd,
                    isLastCommand,
                  })}`
              );

              const proc = cp.spawn(argv[0], argv.slice(1), {
                cwd: this.options.cwd,
                env: this.options.env,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              trace(
                'ProcessRunner',
                () =>
                  `spawnNodeAsync: Child process created | ${JSON.stringify({
                    pid: proc.pid,
                    killed: proc.killed,
                    hasStdout: !!proc.stdout,
                    hasStderr: !!proc.stderr,
                  })}`
              );

              let stdout = '';
              let stderr = '';
              let stdoutChunks = 0;
              let stderrChunks = 0;

              const procPid = proc.pid;

              proc.stdout.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                stdout += chunkStr;
                stdoutChunks++;

                trace(
                  'ProcessRunner',
                  () =>
                    `spawnNodeAsync: stdout chunk received | ${JSON.stringify({
                      pid: procPid,
                      chunkNumber: stdoutChunks,
                      chunkLength: chunk.length,
                      totalStdoutLength: stdout.length,
                      isLastCommand,
                      preview: chunkStr.slice(0, 100),
                    })}`
                );

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

                trace(
                  'ProcessRunner',
                  () =>
                    `spawnNodeAsync: stderr chunk received | ${JSON.stringify({
                      pid: procPid,
                      chunkNumber: stderrChunks,
                      chunkLength: chunk.length,
                      totalStderrLength: stderr.length,
                      isLastCommand,
                      preview: chunkStr.slice(0, 100),
                    })}`
                );

                if (isLastCommand) {
                  if (this.options.mirror) {
                    safeWrite(process.stderr, chunk);
                  }
                  this._emitProcessedData('stderr', chunk);
                }
              });

              proc.on('close', (code) => {
                trace(
                  'ProcessRunner',
                  () =>
                    `spawnNodeAsync: Process closed | ${JSON.stringify({
                      pid: procPid,
                      code,
                      stdoutLength: stdout.length,
                      stderrLength: stderr.length,
                      stdoutChunks,
                      stderrChunks,
                    })}`
                );

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
                trace(
                  'ProcessRunner',
                  () =>
                    `Attempting to write stdin to spawnNodeAsync | ${JSON.stringify(
                      {
                        hasStdin: !!proc.stdin,
                        writable: proc.stdin?.writable,
                        destroyed: proc.stdin?.destroyed,
                        closed: proc.stdin?.closed,
                        stdinLength: stdin.length,
                      },
                      null,
                      2
                    )}`
                );

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

  ProcessRunner.prototype._runPipeline = async function (commands) {
    trace(
      'ProcessRunner',
      () =>
        `_runPipeline ENTER | ${JSON.stringify(
          {
            commandsCount: commands.length,
          },
          null,
          2
        )}`
    );

    if (commands.length === 0) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: _runPipeline => NO_COMMANDS | ${JSON.stringify({}, null, 2)}`
      );
      return createResult({
        code: 1,
        stdout: '',
        stderr: 'No commands in pipeline',
        stdin: '',
      });
    }

    if (isBun) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: _runPipeline => BUN_STREAMING | ${JSON.stringify({}, null, 2)}`
      );
      return this._runStreamingPipelineBun(commands);
    }

    trace(
      'ProcessRunner',
      () =>
        `BRANCH: _runPipeline => NODE_NON_STREAMING | ${JSON.stringify({}, null, 2)}`
    );
    return this._runPipelineNonStreaming(commands);
  };

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
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: _runProgrammaticPipeline => SOURCE_FAILED | ${JSON.stringify(
              {
                code: sourceResult.code,
                stderr: sourceResult.stderr,
              },
              null,
              2
            )}`
        );
        return sourceResult;
      }

      const ProcessRunnerRef = this.constructor;
      const destWithStdin = new ProcessRunnerRef(destination.spec, {
        ...destination.options,
        stdin: sourceResult.stdout,
      });

      const destResult = await destWithStdin;

      trace(
        'ProcessRunner',
        () =>
          `destResult debug | ${JSON.stringify(
            {
              code: destResult.code,
              codeType: typeof destResult.code,
              hasCode: 'code' in destResult,
              keys: Object.keys(destResult),
              resultType: typeof destResult,
              fullResult: JSON.stringify(destResult, null, 2).slice(0, 200),
            },
            null,
            2
          )}`
      );

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

  ProcessRunner.prototype._runSequence = async function (sequence) {
    trace(
      'ProcessRunner',
      () =>
        `_runSequence ENTER | ${JSON.stringify(
          {
            commandCount: sequence.commands.length,
            operators: sequence.operators,
          },
          null,
          2
        )}`
    );

    let lastResult = { code: 0, stdout: '', stderr: '' };
    let combinedStdout = '';
    let combinedStderr = '';

    for (let i = 0; i < sequence.commands.length; i++) {
      const command = sequence.commands[i];
      const operator = i > 0 ? sequence.operators[i - 1] : null;

      trace(
        'ProcessRunner',
        () =>
          `Executing command ${i} | ${JSON.stringify(
            {
              command: command.type,
              operator,
              lastCode: lastResult.code,
            },
            null,
            2
          )}`
      );

      if (operator === '&&' && lastResult.code !== 0) {
        trace(
          'ProcessRunner',
          () => `Skipping due to && with exit code ${lastResult.code}`
        );
        continue;
      }
      if (operator === '||' && lastResult.code === 0) {
        trace(
          'ProcessRunner',
          () => `Skipping due to || with exit code ${lastResult.code}`
        );
        continue;
      }

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
    trace(
      'ProcessRunner',
      () =>
        `_runSubshell ENTER | ${JSON.stringify(
          {
            commandType: subshell.command.type,
          },
          null,
          2
        )}`
    );

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
      trace(
        'ProcessRunner',
        () => `Restoring cwd from ${process.cwd()} to ${savedCwd}`
      );
      const fs = await import('fs');
      if (fs.existsSync(savedCwd)) {
        process.chdir(savedCwd);
      } else {
        const fallbackDir = process.env.HOME || process.env.USERPROFILE || '/';
        trace(
          'ProcessRunner',
          () =>
            `Saved directory ${savedCwd} no longer exists, falling back to ${fallbackDir}`
        );
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
    trace(
      'ProcessRunner',
      () =>
        `_runSimpleCommand ENTER | ${JSON.stringify(
          {
            cmd: command.cmd,
            argsCount: command.args?.length || 0,
            hasRedirects: !!command.redirects,
          },
          null,
          2
        )}`
    );

    const { cmd, args, redirects } = command;

    if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
      trace('ProcessRunner', () => `Using virtual command: ${cmd}`);
      const argValues = args.map((a) => a.value || a);
      const result = await this._runVirtual(cmd, argValues);

      if (redirects && redirects.length > 0) {
        for (const redirect of redirects) {
          if (redirect.type === '>' || redirect.type === '>>') {
            const fs = await import('fs');
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

    if (redirects) {
      for (const redirect of redirects) {
        commandStr += ` ${redirect.type} ${redirect.target}`;
      }
    }

    trace('ProcessRunner', () => `Executing real command: ${commandStr}`);

    const ProcessRunnerRef = this.constructor;
    const runner = new ProcessRunnerRef(
      { mode: 'shell', command: commandStr },
      { ...this.options, cwd: process.cwd(), _bypassVirtual: true }
    );

    return await runner;
  };

  ProcessRunner.prototype.pipe = function (destination) {
    trace(
      'ProcessRunner',
      () =>
        `pipe ENTER | ${JSON.stringify(
          {
            hasDestination: !!destination,
            destinationType: destination?.constructor?.name,
          },
          null,
          2
        )}`
    );

    const ProcessRunnerRef = this.constructor;

    if (destination instanceof ProcessRunnerRef) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: pipe => PROCESS_RUNNER_DEST | ${JSON.stringify({}, null, 2)}`
      );
      const pipeSpec = {
        mode: 'pipeline',
        source: this,
        destination,
      };

      const pipeRunner = new ProcessRunnerRef(pipeSpec, {
        ...this.options,
        capture: destination.options.capture ?? true,
      });

      trace(
        'ProcessRunner',
        () => `pipe EXIT | ${JSON.stringify({ mode: 'pipeline' }, null, 2)}`
      );
      return pipeRunner;
    }

    if (destination && destination.spec) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: pipe => TEMPLATE_LITERAL_DEST | ${JSON.stringify({}, null, 2)}`
      );
      const destRunner = new ProcessRunnerRef(
        destination.spec,
        destination.options
      );
      return this.pipe(destRunner);
    }

    trace(
      'ProcessRunner',
      () => `BRANCH: pipe => INVALID_DEST | ${JSON.stringify({}, null, 2)}`
    );
    throw new Error(
      'pipe() destination must be a ProcessRunner or $`command` result'
    );
  };
}
