// ProcessRunner virtual command methods - virtual command execution
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import { safeWrite } from './$.stream-utils.mjs';

/**
 * Get stdin data from options
 * @param {object} options - Runner options
 * @returns {string} Stdin data
 */
function getStdinData(options) {
  if (options.stdin && typeof options.stdin === 'string') {
    return options.stdin;
  }
  if (options.stdin && Buffer.isBuffer(options.stdin)) {
    return options.stdin.toString('utf8');
  }
  return '';
}

/**
 * Get exit code for cancellation signal
 * @param {string} signal - Cancellation signal
 * @returns {number} Exit code
 */
function getCancellationExitCode(signal) {
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 1;
}

/**
 * Create abort promise for non-generator handlers
 * @param {AbortController} abortController - Abort controller
 * @returns {Promise} Promise that rejects on abort
 */
function createAbortPromise(abortController) {
  return new Promise((_, reject) => {
    if (abortController && abortController.signal.aborted) {
      reject(new Error('Command cancelled'));
    }
    if (abortController) {
      abortController.signal.addEventListener('abort', () => {
        reject(new Error('Command cancelled'));
      });
    }
  });
}

/**
 * Emit output and mirror if needed
 * @param {object} runner - ProcessRunner instance
 * @param {string} type - Output type (stdout/stderr)
 * @param {string} data - Output data
 */
function emitOutput(runner, type, data) {
  if (!data) {
    return;
  }
  const buf = Buffer.from(data);
  const stream = type === 'stdout' ? process.stdout : process.stderr;
  if (runner.options.mirror) {
    safeWrite(stream, buf);
  }
  runner._emitProcessedData(type, buf);
}

/**
 * Handle error in virtual command
 * @param {object} runner - ProcessRunner instance
 * @param {Error} error - Error that occurred
 * @param {object} shellSettings - Global shell settings
 * @returns {object} Result object
 */
function handleVirtualError(runner, error, shellSettings) {
  let exitCode = error.code ?? 1;
  if (runner._cancelled && runner._cancellationSignal) {
    exitCode = getCancellationExitCode(runner._cancellationSignal);
  }

  const result = {
    code: exitCode,
    stdout: error.stdout ?? '',
    stderr: error.stderr ?? error.message,
    stdin: '',
  };

  emitOutput(runner, 'stderr', result.stderr);
  runner.finish(result);

  if (shellSettings.errexit) {
    error.result = result;
    throw error;
  }

  return result;
}

/**
 * Run async generator handler
 * @param {object} runner - ProcessRunner instance
 * @param {Function} handler - Generator handler
 * @param {Array} argValues - Argument values
 * @param {string} stdinData - Stdin data
 * @returns {Promise<object>} Result object
 */
async function runGeneratorHandler(runner, handler, argValues, stdinData) {
  const chunks = [];
  const commandOptions = {
    cwd: runner.options.cwd,
    env: runner.options.env,
    options: runner.options,
    isCancelled: () => runner._cancelled,
  };

  const generator = handler({
    args: argValues,
    stdin: stdinData,
    abortSignal: runner._abortController?.signal,
    ...commandOptions,
  });
  runner._virtualGenerator = generator;

  const cancelPromise = new Promise((resolve) => {
    runner._cancelResolve = resolve;
  });

  try {
    const iterator = generator[Symbol.asyncIterator]();
    let done = false;

    while (!done && !runner._cancelled) {
      const result = await Promise.race([
        iterator.next(),
        cancelPromise.then(() => ({ done: true, cancelled: true })),
      ]);

      if (result.cancelled || runner._cancelled) {
        if (iterator.return) {
          await iterator.return();
        }
        break;
      }

      done = result.done;

      if (!done && !runner._cancelled && !runner._streamBreaking) {
        const buf = Buffer.from(result.value);
        chunks.push(buf);

        if (runner.options.mirror) {
          safeWrite(process.stdout, buf);
        }
        runner._emitProcessedData('stdout', buf);
      }
    }
  } finally {
    runner._virtualGenerator = null;
    runner._cancelResolve = null;
  }

  return {
    code: 0,
    stdout: runner.options.capture
      ? Buffer.concat(chunks).toString('utf8')
      : undefined,
    stderr: runner.options.capture ? '' : undefined,
    stdin: runner.options.capture ? stdinData : undefined,
  };
}

/**
 * Run regular (non-generator) handler
 * @param {object} runner - ProcessRunner instance
 * @param {Function} handler - Handler function
 * @param {Array} argValues - Argument values
 * @param {string} stdinData - Stdin data
 * @returns {Promise<object>} Result object
 */
async function runRegularHandler(runner, handler, argValues, stdinData) {
  const commandOptions = {
    cwd: runner.options.cwd,
    env: runner.options.env,
    options: runner.options,
    isCancelled: () => runner._cancelled,
  };

  const handlerPromise = handler({
    args: argValues,
    stdin: stdinData,
    abortSignal: runner._abortController?.signal,
    ...commandOptions,
  });

  const abortPromise = createAbortPromise(runner._abortController);
  let result;

  try {
    result = await Promise.race([handlerPromise, abortPromise]);
  } catch (err) {
    if (err.message === 'Command cancelled') {
      const exitCode = getCancellationExitCode(runner._cancellationSignal);
      result = { code: exitCode, stdout: '', stderr: '' };
    } else {
      throw err;
    }
  }

  result = {
    ...result,
    code: result.code ?? 0,
    stdout: runner.options.capture ? (result.stdout ?? '') : undefined,
    stderr: runner.options.capture ? (result.stderr ?? '') : undefined,
    stdin: runner.options.capture ? stdinData : undefined,
  };

  emitOutput(runner, 'stdout', result.stdout);
  emitOutput(runner, 'stderr', result.stderr);

  return result;
}

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
    trace('ProcessRunner', () => `_runVirtual | cmd=${cmd}`);

    const handler = virtualCommands.get(cmd);
    if (!handler) {
      throw new Error(`Virtual command not found: ${cmd}`);
    }

    try {
      // Special handling for streaming mode (stdin: "pipe")
      if (this.options.stdin === 'pipe') {
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
      }

      const stdinData = getStdinData(this.options);
      const argValues = args.map((arg) =>
        arg.value !== undefined ? arg.value : arg
      );

      if (globalShellSettings.xtrace) {
        console.log(`+ ${originalCommand || `${cmd} ${argValues.join(' ')}`}`);
      }
      if (globalShellSettings.verbose) {
        console.log(`${originalCommand || `${cmd} ${argValues.join(' ')}`}`);
      }

      const isGenerator = handler.constructor.name === 'AsyncGeneratorFunction';
      const result = isGenerator
        ? await runGeneratorHandler(this, handler, argValues, stdinData)
        : await runRegularHandler(this, handler, argValues, stdinData);

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
      return handleVirtualError(this, error, globalShellSettings);
    }
  };
}
