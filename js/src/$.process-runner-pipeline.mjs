// ProcessRunner pipeline methods - all pipeline execution strategies
// Part of the modular ProcessRunner architecture

import cp from 'child_process';
import { trace } from './$.trace.mjs';
import { findAvailableShell } from './$.shell.mjs';
import { StreamUtils, safeWrite } from './$.stream-utils.mjs';
import { createResult } from './$.result.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Commands that need streaming workaround
 */
const STREAMING_COMMANDS = ['jq', 'grep', 'sed', 'cat', 'awk'];

/**
 * Check if command needs streaming workaround
 * @param {object} command - Command object
 * @returns {boolean}
 */
function needsStreamingWorkaround(command) {
  return STREAMING_COMMANDS.includes(command.cmd);
}

/**
 * Analyze pipeline for virtual commands
 * @param {Array} commands - Pipeline commands
 * @param {Function} isVirtualCommandsEnabled - Check if virtual commands enabled
 * @param {Map} virtualCommands - Virtual commands registry
 * @returns {object} Analysis result
 */
function analyzePipeline(commands, isVirtualCommandsEnabled, virtualCommands) {
  const pipelineInfo = commands.map((command) => ({
    ...command,
    isVirtual: isVirtualCommandsEnabled() && virtualCommands.has(command.cmd),
  }));
  return {
    pipelineInfo,
    hasVirtual: pipelineInfo.some((info) => info.isVirtual),
    virtualCount: pipelineInfo.filter((p) => p.isVirtual).length,
    realCount: pipelineInfo.filter((p) => !p.isVirtual).length,
  };
}

/**
 * Read stream to string
 * @param {ReadableStream} stream - Stream to read
 * @returns {Promise<string>}
 */
async function readStreamToString(stream) {
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
}

/**
 * Build command parts from command object
 * @param {object} command - Command with cmd and args
 * @returns {string[]} Command parts array
 */
function buildCommandParts(command) {
  const { cmd, args } = command;
  const parts = [cmd];
  for (const arg of args) {
    if (arg.value !== undefined) {
      if (arg.quoted) {
        parts.push(`${arg.quoteChar}${arg.value}${arg.quoteChar}`);
      } else if (arg.value.includes(' ')) {
        parts.push(`"${arg.value}"`);
      } else {
        parts.push(arg.value);
      }
    } else if (
      typeof arg === 'string' &&
      arg.includes(' ') &&
      !arg.startsWith('"') &&
      !arg.startsWith("'")
    ) {
      parts.push(`"${arg}"`);
    } else {
      parts.push(arg);
    }
  }
  return parts;
}

/**
 * Check if command string needs shell execution
 * @param {string} commandStr - Command string
 * @returns {boolean}
 */
function needsShellExecution(commandStr) {
  return (
    commandStr.includes('*') ||
    commandStr.includes('$') ||
    commandStr.includes('>') ||
    commandStr.includes('<') ||
    commandStr.includes('&&') ||
    commandStr.includes('||') ||
    commandStr.includes(';') ||
    commandStr.includes('`')
  );
}

/**
 * Get spawn args based on shell need
 * @param {boolean} needsShell - Whether shell is needed
 * @param {string} cmd - Command name
 * @param {Array} args - Command args
 * @param {string} commandStr - Full command string
 * @returns {string[]} Spawn arguments
 */
function getSpawnArgs(needsShell, cmd, args, commandStr) {
  if (needsShell) {
    const shell = findAvailableShell();
    return [shell.cmd, ...shell.args.filter((arg) => arg !== '-l'), commandStr];
  }
  return [cmd, ...args.map((a) => (a.value !== undefined ? a.value : a))];
}

/**
 * Determine stdin configuration for first command
 * @param {object} options - Runner options
 * @returns {object} Stdin config with stdin, needsManualStdin, stdinData
 */
function getFirstCommandStdin(options) {
  if (options.stdin && typeof options.stdin === 'string') {
    return {
      stdin: 'pipe',
      needsManualStdin: true,
      stdinData: Buffer.from(options.stdin),
    };
  }
  if (options.stdin && Buffer.isBuffer(options.stdin)) {
    return { stdin: 'pipe', needsManualStdin: true, stdinData: options.stdin };
  }
  return { stdin: 'ignore', needsManualStdin: false, stdinData: null };
}

/**
 * Get stdin string from options
 * @param {object} options - Runner options
 * @returns {string}
 */
function getStdinString(options) {
  if (options.stdin && typeof options.stdin === 'string') {
    return options.stdin;
  }
  if (options.stdin && Buffer.isBuffer(options.stdin)) {
    return options.stdin.toString('utf8');
  }
  return '';
}

/**
 * Handle pipefail check
 * @param {number[]} exitCodes - Exit codes from pipeline
 * @param {object} shellSettings - Shell settings
 */
function checkPipefail(exitCodes, shellSettings) {
  if (shellSettings.pipefail) {
    const failedIndex = exitCodes.findIndex((code) => code !== 0);
    if (failedIndex !== -1) {
      const error = new Error(
        `Pipeline command at index ${failedIndex} failed with exit code ${exitCodes[failedIndex]}`
      );
      error.code = exitCodes[failedIndex];
      throw error;
    }
  }
}

/**
 * Create and throw errexit error
 * @param {object} result - Result object
 * @param {object} shellSettings - Shell settings
 */
function throwErrexitError(result, shellSettings) {
  if (shellSettings.errexit && result.code !== 0) {
    const error = new Error(`Pipeline failed with exit code ${result.code}`);
    error.code = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.result = result;
    throw error;
  }
}

/**
 * Write stdin to Bun process
 * @param {object} proc - Process with stdin
 * @param {Buffer} stdinData - Data to write
 */
async function writeBunStdin(proc, stdinData) {
  if (!proc.stdin) {
    return;
  }
  const stdinHandler = StreamUtils.setupStdinHandling(
    proc.stdin,
    'Bun process stdin'
  );
  try {
    if (stdinHandler.isWritable()) {
      await proc.stdin.write(stdinData);
      await proc.stdin.end();
    }
  } catch (e) {
    if (e.code !== 'EPIPE') {
      trace('ProcessRunner', () => `stdin write error | ${e.message}`);
    }
  }
}

/**
 * Collect stderr from process async
 * @param {object} runner - ProcessRunner
 * @param {object} proc - Process
 * @param {boolean} isLast - Is last command
 * @param {object} collector - Object to collect stderr
 */
function collectStderrAsync(runner, proc, isLast, collector) {
  (async () => {
    for await (const chunk of proc.stderr) {
      const buf = Buffer.from(chunk);
      collector.stderr += buf.toString();
      if (isLast) {
        if (runner.options.mirror) {
          safeWrite(process.stderr, buf);
        }
        runner._emitProcessedData('stderr', buf);
      }
    }
  })();
}

/**
 * Create initial input stream from stdin option
 * @param {object} options - Runner options
 * @returns {ReadableStream|null}
 */
function createInitialInputStream(options) {
  if (!options.stdin) {
    return null;
  }
  const inputData =
    typeof options.stdin === 'string'
      ? options.stdin
      : options.stdin.toString('utf8');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(inputData));
      controller.close();
    },
  });
}

/**
 * Get argument values from args array
 * @param {Array} args - Args array
 * @returns {Array} Argument values
 */
function getArgValues(args) {
  return args.map((arg) => (arg.value !== undefined ? arg.value : arg));
}

/**
 * Create readable stream from string
 * @param {string} data - String data
 * @returns {ReadableStream}
 */
function createStringStream(data) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });
}

/**
 * Pipe stream to process stdin
 * @param {ReadableStream} stream - Input stream
 * @param {object} proc - Process
 */
function pipeStreamToProcess(stream, proc) {
  if (!stream || !proc.stdin) {
    return;
  }
  const reader = stream.getReader();
  const writer = proc.stdin.getWriter ? proc.stdin.getWriter() : proc.stdin;

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
            StreamUtils.handleStreamError(error, 'stream writer', false);
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

/**
 * Spawn shell command in Bun
 * @param {string} commandStr - Command string
 * @param {object} options - Options (cwd, env, stdin)
 * @returns {object} Process
 */
function spawnShellCommand(commandStr, options) {
  const shell = findAvailableShell();
  return Bun.spawn(
    [shell.cmd, ...shell.args.filter((arg) => arg !== '-l'), commandStr],
    {
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
}

/**
 * Collect last command stdout
 * @param {object} runner - ProcessRunner
 * @param {object} proc - Process
 * @returns {Promise<string>} Output string
 */
async function collectFinalStdout(runner, proc) {
  const chunks = [];
  for await (const chunk of proc.stdout) {
    const buf = Buffer.from(chunk);
    chunks.push(buf);
    if (runner.options.mirror) {
      safeWrite(process.stdout, buf);
    }
    runner._emitProcessedData('stdout', buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Spawn async node process for pipeline
 * @param {object} runner - ProcessRunner instance
 * @param {string[]} argv - Command arguments
 * @param {string} stdin - Stdin input
 * @param {boolean} isLastCommand - Is this the last command
 * @returns {Promise<object>} Result with status, stdout, stderr
 */
function spawnNodeAsync(runner, argv, stdin, isLastCommand) {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(argv[0], argv.slice(1), {
      cwd: runner.options.cwd,
      env: runner.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (isLastCommand) {
        if (runner.options.mirror) {
          safeWrite(process.stdout, chunk);
        }
        runner._emitProcessedData('stdout', chunk);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (isLastCommand) {
        if (runner.options.mirror) {
          safeWrite(process.stderr, chunk);
        }
        runner._emitProcessedData('stderr', chunk);
      }
    });

    proc.on('close', (code) => resolve({ status: code, stdout, stderr }));
    proc.on('error', reject);

    if (proc.stdin) {
      StreamUtils.addStdinErrorHandler(
        proc.stdin,
        'spawnNodeAsync stdin',
        reject
      );
    }
    if (stdin) {
      StreamUtils.safeStreamWrite(proc.stdin, stdin, 'spawnNodeAsync stdin');
    }
    StreamUtils.safeStreamEnd(proc.stdin, 'spawnNodeAsync stdin');
  });
}

/**
 * Log shell trace/verbose
 * @param {object} settings - Shell settings
 * @param {string} cmd - Command
 * @param {string[]} argValues - Argument values
 */
function logShellTrace(settings, cmd, argValues) {
  const cmdStr = `${cmd} ${argValues.join(' ')}`;
  if (settings.xtrace) {
    console.log(`+ ${cmdStr}`);
  }
  if (settings.verbose) {
    console.log(cmdStr);
  }
}

/**
 * Handle virtual command in non-streaming pipeline
 * @param {object} runner - ProcessRunner instance
 * @param {Function} handler - Handler function
 * @param {string[]} argValues - Argument values
 * @param {string} currentInput - Current input
 * @param {object} options - Runner options
 * @returns {Promise<object>} Result
 */
async function runVirtualHandler(
  runner,
  handler,
  argValues,
  currentInput,
  options
) {
  if (handler.constructor.name === 'AsyncGeneratorFunction') {
    const chunks = [];
    for await (const chunk of handler({
      args: argValues,
      stdin: currentInput,
      ...options,
    })) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      code: 0,
      stdout: options.capture
        ? Buffer.concat(chunks).toString('utf8')
        : undefined,
      stderr: options.capture ? '' : undefined,
      stdin: options.capture ? currentInput : undefined,
    };
  }
  const result = await handler({
    args: argValues,
    stdin: currentInput,
    ...options,
  });
  return {
    ...result,
    code: result.code ?? 0,
    stdout: options.capture ? (result.stdout ?? '') : undefined,
    stderr: options.capture ? (result.stderr ?? '') : undefined,
    stdin: options.capture ? currentInput : undefined,
  };
}

/**
 * Emit final result output
 * @param {object} runner - ProcessRunner instance
 * @param {object} result - Result object
 */
function emitFinalOutput(runner, result) {
  if (result.stdout) {
    const buf = Buffer.from(result.stdout);
    if (runner.options.mirror) {
      safeWrite(process.stdout, buf);
    }
    runner._emitProcessedData('stdout', buf);
  }
  if (result.stderr) {
    const buf = Buffer.from(result.stderr);
    if (runner.options.mirror) {
      safeWrite(process.stderr, buf);
    }
    runner._emitProcessedData('stderr', buf);
  }
}

/**
 * Create final result for pipeline
 * @param {object} runner - ProcessRunner instance
 * @param {object} result - Current result
 * @param {string} currentOutput - Current output
 * @param {object} shellSettings - Shell settings
 * @returns {object} Final result
 */
function createFinalPipelineResult(
  runner,
  result,
  currentOutput,
  shellSettings
) {
  const finalResult = createResult({
    code: result.code,
    stdout: currentOutput,
    stderr: result.stderr,
    stdin: getStdinString(runner.options),
  });
  runner.finish(finalResult);
  throwErrexitError(finalResult, shellSettings);
  return finalResult;
}

/**
 * Handle pipeline error
 * @param {object} runner - ProcessRunner instance
 * @param {Error} error - Error
 * @param {string} currentOutput - Current output
 * @param {object} shellSettings - Shell settings
 * @returns {object} Error result
 */
function handlePipelineError(runner, error, currentOutput, shellSettings) {
  const result = createResult({
    code: error.code ?? 1,
    stdout: currentOutput,
    stderr: error.stderr ?? error.message,
    stdin: getStdinString(runner.options),
  });
  if (result.stderr) {
    const buf = Buffer.from(result.stderr);
    if (runner.options.mirror) {
      safeWrite(process.stderr, buf);
    }
    runner._emitProcessedData('stderr', buf);
  }
  runner.finish(result);
  if (shellSettings.errexit) {
    throw error;
  }
  return result;
}

/**
 * Handle virtual command in non-streaming pipeline iteration
 * @param {object} runner - ProcessRunner instance
 * @param {object} command - Command object
 * @param {string} currentInput - Current input
 * @param {boolean} isLastCommand - Is last command
 * @param {object} deps - Dependencies
 * @returns {Promise<object>} { output, input, finalResult }
 */
async function handleVirtualPipelineCommand(
  runner,
  command,
  currentInput,
  isLastCommand,
  deps
) {
  const { virtualCommands, globalShellSettings } = deps;
  const handler = virtualCommands.get(command.cmd);
  const argValues = getArgValues(command.args);
  logShellTrace(globalShellSettings, command.cmd, argValues);

  const result = await runVirtualHandler(
    runner,
    handler,
    argValues,
    currentInput,
    runner.options
  );

  if (isLastCommand) {
    emitFinalOutput(runner, result);
    return {
      finalResult: createFinalPipelineResult(
        runner,
        result,
        result.stdout,
        globalShellSettings
      ),
    };
  }

  if (globalShellSettings.errexit && result.code !== 0) {
    const error = new Error(
      `Pipeline command failed with exit code ${result.code}`
    );
    error.code = result.code;
    error.result = result;
    throw error;
  }

  return { input: result.stdout };
}

/**
 * Handle shell command in non-streaming pipeline iteration
 * @param {object} runner - ProcessRunner instance
 * @param {object} command - Command object
 * @param {string} currentInput - Current input
 * @param {boolean} isLastCommand - Is last command
 * @param {object} deps - Dependencies
 * @returns {Promise<object>} { output, input, finalResult }
 */
async function handleShellPipelineCommand(
  runner,
  command,
  currentInput,
  isLastCommand,
  deps
) {
  const { globalShellSettings } = deps;
  const commandStr = buildCommandParts(command).join(' ');
  logShellTrace(globalShellSettings, commandStr, []);

  const shell = findAvailableShell();
  const argv = [shell.cmd, ...shell.args.filter((a) => a !== '-l'), commandStr];
  const proc = await spawnNodeAsync(runner, argv, currentInput, isLastCommand);
  const result = {
    code: proc.status || 0,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
  };

  if (globalShellSettings.pipefail && result.code !== 0) {
    const error = new Error(
      `Pipeline command '${commandStr}' failed with exit code ${result.code}`
    );
    error.code = result.code;
    throw error;
  }

  if (isLastCommand) {
    let allStderr = '';
    if (runner.errChunks?.length > 0) {
      allStderr = Buffer.concat(runner.errChunks).toString('utf8');
    }
    if (result.stderr) {
      allStderr += result.stderr;
    }
    const finalResult = createResult({
      code: result.code,
      stdout: result.stdout,
      stderr: allStderr,
      stdin: getStdinString(runner.options),
    });
    runner.finish(finalResult);
    throwErrexitError(finalResult, globalShellSettings);
    return { finalResult };
  }

  if (result.stderr && runner.options.capture) {
    runner.errChunks = runner.errChunks || [];
    runner.errChunks.push(Buffer.from(result.stderr));
  }

  return { input: result.stdout };
}

/**
 * Attach pipeline methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies
 */
export function attachPipelineMethods(ProcessRunner, deps) {
  const { virtualCommands, globalShellSettings, isVirtualCommandsEnabled } =
    deps;

  // Use module-level helper
  ProcessRunner.prototype._readStreamToString = readStreamToString;

  ProcessRunner.prototype._runStreamingPipelineBun = async function (commands) {
    trace(
      'ProcessRunner',
      () => `_runStreamingPipelineBun | cmds=${commands.length}`
    );

    const analysis = analyzePipeline(
      commands,
      isVirtualCommandsEnabled,
      virtualCommands
    );
    if (analysis.hasVirtual) {
      return this._runMixedStreamingPipeline(commands);
    }
    if (commands.some(needsStreamingWorkaround)) {
      return this._runTeeStreamingPipeline(commands);
    }

    const processes = [];
    const collector = { stderr: '' };

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const commandStr = buildCommandParts(command).join(' ');
      const needsShell = needsShellExecution(commandStr);
      const spawnArgs = getSpawnArgs(
        needsShell,
        command.cmd,
        command.args,
        commandStr
      );

      let stdin;
      let stdinConfig = null;
      if (i === 0) {
        stdinConfig = getFirstCommandStdin(this.options);
        stdin = stdinConfig.stdin;
      } else {
        stdin = processes[i - 1].stdout;
      }

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (stdinConfig?.needsManualStdin && stdinConfig.stdinData) {
        writeBunStdin(proc, stdinConfig.stdinData);
      }

      processes.push(proc);
      collectStderrAsync(this, proc, i === commands.length - 1, collector);
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
    checkPipefail(exitCodes, globalShellSettings);

    const result = createResult({
      code: exitCodes[exitCodes.length - 1] || 0,
      stdout: finalOutput,
      stderr: collector.stderr,
      stdin: getStdinString(this.options),
    });

    this.finish(result);
    throwErrexitError(result, globalShellSettings);
    return result;
  };

  ProcessRunner.prototype._runTeeStreamingPipeline = async function (commands) {
    trace(
      'ProcessRunner',
      () => `_runTeeStreamingPipeline | cmds=${commands.length}`
    );

    const processes = [];
    const collector = { stderr: '' };
    let currentStream = null;

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const commandStr = buildCommandParts(command).join(' ');
      const needsShell = needsShellExecution(commandStr);
      const spawnArgs = getSpawnArgs(
        needsShell,
        command.cmd,
        command.args,
        commandStr
      );

      let stdin;
      let stdinConfig = null;
      if (i === 0) {
        stdinConfig = getFirstCommandStdin(this.options);
        stdin = stdinConfig.stdin;
      } else {
        stdin = currentStream;
      }

      const proc = Bun.spawn(spawnArgs, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdin,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (
        stdinConfig?.needsManualStdin &&
        stdinConfig.stdinData &&
        proc.stdin
      ) {
        await writeBunStdin(proc, stdinConfig.stdinData);
      }

      processes.push(proc);

      if (i < commands.length - 1) {
        const [readStream, pipeStream] = proc.stdout.tee();
        currentStream = pipeStream;
        (async () => {
          for await (const _chunk of readStream) {
            /* consume */
          }
        })();
      } else {
        currentStream = proc.stdout;
      }

      collectStderrAsync(this, proc, i === commands.length - 1, collector);
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
    checkPipefail(exitCodes, globalShellSettings);

    const result = createResult({
      code: exitCodes[exitCodes.length - 1] || 0,
      stdout: finalOutput,
      stderr: collector.stderr,
      stdin: getStdinString(this.options),
    });

    this.finish(result);
    throwErrexitError(result, globalShellSettings);
    return result;
  };

  ProcessRunner.prototype._runMixedStreamingPipeline = async function (
    commands
  ) {
    trace(
      'ProcessRunner',
      () => `_runMixedStreamingPipeline | cmds=${commands.length}`
    );

    let currentInputStream = createInitialInputStream(this.options);
    let finalOutput = '';
    const collector = { stderr: '' };

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;
      const isLastCommand = i === commands.length - 1;

      if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
        const handler = virtualCommands.get(cmd);
        const argValues = getArgValues(args);
        const inputData = currentInputStream
          ? await this._readStreamToString(currentInputStream)
          : '';

        if (handler.constructor.name === 'AsyncGeneratorFunction') {
          const chunks = [];
          const self = this;
          currentInputStream = new ReadableStream({
            async start(controller) {
              const { stdin: _, ...opts } = self.options;
              for await (const chunk of handler({
                args: argValues,
                stdin: inputData,
                ...opts,
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
          const { stdin: _, ...opts } = this.options;
          const result = await handler({
            args: argValues,
            stdin: inputData,
            ...opts,
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
          currentInputStream = createStringStream(outputData);
          if (result.stderr) {
            collector.stderr += result.stderr;
          }
        }
      } else {
        const commandStr = buildCommandParts(command).join(' ');
        const proc = spawnShellCommand(commandStr, {
          cwd: this.options.cwd,
          env: this.options.env,
          stdin: currentInputStream ? 'pipe' : 'ignore',
        });

        pipeStreamToProcess(currentInputStream, proc);
        currentInputStream = proc.stdout;
        collectStderrAsync(this, proc, isLastCommand, collector);

        if (isLastCommand) {
          finalOutput = await collectFinalStdout(this, proc);
          await proc.exited;
        }
      }
    }

    const result = createResult({
      code: 0,
      stdout: finalOutput,
      stderr: collector.stderr,
      stdin: getStdinString(this.options),
    });

    this.finish(result);
    return result;
  };

  ProcessRunner.prototype._runPipelineNonStreaming = async function (commands) {
    trace(
      'ProcessRunner',
      () => `_runPipelineNonStreaming | cmds=${commands.length}`
    );

    const currentOutput = '';
    let currentInput = getStdinString(this.options);
    const pipelineDeps = { virtualCommands, globalShellSettings };

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const isLastCommand = i === commands.length - 1;
      const isVirtual =
        isVirtualCommandsEnabled() && virtualCommands.has(command.cmd);

      try {
        const handleResult = isVirtual
          ? await handleVirtualPipelineCommand(
              this,
              command,
              currentInput,
              isLastCommand,
              pipelineDeps
            )
          : await handleShellPipelineCommand(
              this,
              command,
              currentInput,
              isLastCommand,
              pipelineDeps
            );

        if (handleResult.finalResult) {
          return handleResult.finalResult;
        }
        currentInput = handleResult.input;
      } catch (error) {
        return handlePipelineError(
          this,
          error,
          currentOutput,
          globalShellSettings
        );
      }
    }
  };

  ProcessRunner.prototype._runPipeline = function (commands) {
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
}
