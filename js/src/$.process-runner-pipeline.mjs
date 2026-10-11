import {
  isCommandIterable,
  createGeneratorStage,
  virtualContext,
} from './$.command-output.mjs';
// ProcessRunner pipeline methods - all pipeline execution strategies
// Part of the modular ProcessRunner architecture

import cp from 'child_process';
import { Readable, Writable } from 'node:stream';
import { createExitPromise } from './$.process-runner-exit.mjs';
import { killChildProcess } from './$.process-runner-stream-kill.mjs';
import { trace } from './$.trace.mjs';
import { findAvailableShell, withExportedProcessContext } from './$.shell.mjs';
import {
  StreamUtils,
  safeWrite,
  stdinDataFromOptions,
} from './$.stream-utils.mjs';
import { createCommandError, createResult } from './$.result.mjs';
import {
  applyVirtualProcessContext,
  effectiveCwd,
  effectiveEnv,
} from './$.process-context.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Read stream to string
 * @param {ReadableStream} stream - Stream to read
 * @returns {Promise<string>}
 */
async function readStreamToString(stream) {
  const reader = stream.getReader();
  let result = '';
  const decoder = new TextDecoder();
  try {
    let done = false;
    while (!done) {
      const readResult = await reader.read();
      done = readResult.done;
      if (!done && readResult.value) {
        result += decoder.decode(readResult.value, { stream: true });
      }
    }
  } finally {
    reader.releaseLock();
  }
  return result + decoder.decode();
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
      // `raw` preserves the word exactly as written (quotes and all), so
      // handing it back to a real shell round-trips without re-quoting guesses.
      if (arg.raw !== undefined) {
        parts.push(arg.raw);
      } else if (arg.quoted) {
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
 * Get stdin string from options
 * @param {object} options - Runner options
 * @returns {string}
 */
function getStdinString(options) {
  return stdinDataFromOptions(options);
}

/**
 * Compute the status reported by a pipeline. Without pipefail this is the last
 * stage; with pipefail it is the rightmost failing stage, matching Bash.
 * pipefail changes the status only. errexit decides whether that status throws.
 *
 * @param {number[]} exitCodes - Exit codes from pipeline
 * @param {object} shellSettings - Shell settings
 * @returns {number} Pipeline exit status
 */
function pipelineExitCode(exitCodes, shellSettings) {
  const codes = exitCodes.map((code) => code ?? 0);
  const last = codes.at(-1) ?? 0;
  if (!shellSettings.pipefail) {
    return last;
  }
  return codes.findLast((code) => code !== 0) ?? last;
}

/**
 * Create and throw errexit error
 * @param {object} result - Result object
 * @param {object} shellSettings - Shell settings
 */
function throwErrexitError(result, shellSettings) {
  if (shellSettings.errexit && result.code !== 0) {
    throw createCommandError(`Pipeline failed with exit code ${result.code}`, {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      result,
    });
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
  return (async () => {
    for await (const chunk of proc.stderr) {
      const buf = Buffer.from(chunk);
      if (runner.options.capture) {
        collector.stderr += buf.toString();
      }
      if (isLast) {
        if (runner.options.mirror) {
          safeWrite(process.stderr, buf);
        }
        runner._emitProcessedData('stderr', buf);
        await runner._waitForStreamCapacity();
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
 * @returns {Promise<void>|undefined} Resolves when the pump has finished
 */
export function pipeStreamToProcess(stream, proc) {
  if (!stream || !proc.stdin) {
    return undefined;
  }
  const reader = stream.getReader();
  const writer = proc.stdin.getWriter ? proc.stdin.getWriter() : proc.stdin;

  const promise = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (writer.write) {
          try {
            await writer.write(value);
            await writer.flush?.();
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
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      // The downstream process may already have exited and closed its stdin,
      // in which case closing the writer raises EPIPE. That is a normal
      // pipeline race, not an error worth propagating as an unhandled
      // rejection.
      try {
        if (writer.close) {
          await writer.close();
        } else if (writer.end) {
          writer.end();
        }
      } catch (error) {
        StreamUtils.handleStreamError(error, 'stream writer close', false);
      }
    }
  })();

  return promise.catch((error) => {
    StreamUtils.handleStreamError(error, 'stream pipe', false);
  });
}

/**
 * Spawn shell command in Bun
 * @param {string} commandStr - Command string
 * @param {object} options - Options (cwd, env, stdin)
 * @returns {object} Process
 */
function spawnShellCommand(commandStr, options) {
  const shell = findAvailableShell();
  const argv = [
    shell.cmd,
    ...shell.args.filter((arg) => arg !== '-l'),
    withExportedProcessContext(commandStr, options.env),
  ];
  if (isBun) {
    return Bun.spawn(argv, {
      ...options,
      stdout: 'pipe',
      stderr: 'pipe',
      detached: process.platform !== 'win32',
    });
  }
  const child = cp.spawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin, 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    createExitPromise(child).then(({ code }) => resolve(code ?? 1));
  });
  // A spawn error can occur before the caller starts awaiting stage statuses.
  exited.catch(() => {});
  return {
    pid: child.pid,
    stdout: Readable.toWeb(child.stdout, {
      strategy: { highWaterMark: 65536, size: (chunk) => chunk.byteLength },
    }),
    stderr: child.stderr,
    stdin: child.stdin ? Writable.toWeb(child.stdin) : null,
    exited,
    kill: (signal) => child.kill(signal),
  };
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
    if (runner.options.capture) {
      chunks.push(buf);
    }
    if (runner.options.mirror) {
      safeWrite(process.stdout, buf);
    }
    runner._emitProcessedData('stdout', buf);
    await runner._waitForStreamCapacity();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function emitVirtualStage(runner, result) {
  for (const type of ['stdout', 'stderr']) {
    if (!result[type]) {
      continue;
    }
    const bytes = Buffer.from(result[type]);
    if (runner.options.mirror) {
      safeWrite(type === 'stdout' ? process.stdout : process.stderr, bytes);
    }
    runner._emitProcessedData(type, bytes);
    await runner._waitForStreamCapacity();
  }
}

async function virtualPipelineStage(
  runner,
  handler,
  command,
  input,
  last,
  collector
) {
  const data = input ? await readStreamToString(input) : '';
  const args = getArgValues(command.args);
  const result = await handler(virtualContext(runner, args, data));
  if (isCommandIterable(result)) {
    const stage = createGeneratorStage(result, runner, last);
    if (last) {
      for await (const _chunk of stage.stream) {
        /* stage emits while pulled */
      }
    }
    return {
      stream: stage.stream,
      code: stage.done,
      output: last ? stage.output() : '',
    };
  }
  applyVirtualProcessContext(runner, result);
  if (result.stderr && runner.options.capture) {
    collector.stderr += result.stderr;
  }
  if (last) {
    await emitVirtualStage(runner, result);
  }
  return {
    stream: createStringStream(result.stdout || ''),
    code: result.code ?? 0,
    output: result.stdout || '',
  };
}

function nativePipelineStage(runner, command, input, last, collector, pumps) {
  const proc = spawnShellCommand(buildCommandParts(command).join(' '), {
    cwd: effectiveCwd(runner),
    env: effectiveEnv(runner),
    stdin: input ? 'pipe' : 'ignore',
  });
  const stop = () =>
    killChildProcess(
      proc,
      runner._cancellationSignal ?? 'SIGTERM',
      runner.options.killGrace
    );
  runner._abortController.signal.addEventListener('abort', stop, {
    once: true,
  });
  proc.exited
    .finally(() =>
      runner._abortController.signal.removeEventListener('abort', stop)
    )
    .catch(() => {});
  for (const pump of [
    pipeStreamToProcess(input, proc),
    collectStderrAsync(runner, proc, last, collector),
  ]) {
    if (pump) {
      pump.catch(() => {});
      pumps.push(pump);
    }
  }
  return proc;
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

  ProcessRunner.prototype._runStreamingPipelineBun = function (commands) {
    trace(
      'ProcessRunner',
      () => `_runStreamingPipelineBun | cmds=${commands.length}`
    );

    return this._runMixedStreamingPipeline(commands);
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
    const pumps = [];
    const stageCodes = [];

    for (let i = 0; i < commands.length; i++) {
      if (this._cancelled) {
        await currentInputStream?.cancel();
        break;
      }
      const command = commands[i];
      const { cmd } = command;
      const isLastCommand = i === commands.length - 1;

      if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
        const stage = await virtualPipelineStage(
          this,
          virtualCommands.get(cmd),
          command,
          currentInputStream,
          isLastCommand,
          collector
        );
        currentInputStream = stage.stream;
        stageCodes.push(stage.code);
        if (isLastCommand) {
          finalOutput = stage.output;
        }
      } else {
        const proc = nativePipelineStage(
          this,
          command,
          currentInputStream,
          isLastCommand,
          collector,
          pumps
        );
        currentInputStream = proc.stdout;
        stageCodes.push(proc.exited);
        if (isLastCommand) {
          finalOutput = await collectFinalStdout(this, proc);
        }
      }
    }

    const exitCodes = await Promise.all(stageCodes);
    await Promise.all(pumps);

    const result = createResult({
      code: pipelineExitCode(exitCodes, globalShellSettings),
      stdout: this.options.capture ? finalOutput : undefined,
      stderr: this.options.capture ? collector.stderr : undefined,
      stdin: this.options.capture ? getStdinString(this.options) : undefined,
    });

    this.finish(result);
    throwErrexitError(result, globalShellSettings);
    return result;
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
        `BRANCH: _runPipeline => NODE_STREAMING | ${JSON.stringify({}, null, 2)}`
    );
    return this._runMixedStreamingPipeline(commands);
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
      const sourceResult = await source._startAsync();

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

      const destResult = await destWithStdin._startAsync();

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
