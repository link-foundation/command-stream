// Result creation utilities for command-stream
// Creates standardized result objects

/**
 * Create a standardized result object
 * @param {object} params - Result parameters
 * @param {number} params.code - Exit code
 * @param {string} params.stdout - Standard output
 * @param {string} params.stderr - Standard error
 * @param {string} params.stdin - Standard input that was sent
 * @returns {object} Result object with text() method
 */
export function createResult({ code, stdout = '', stderr = '', stdin = '' }) {
  return {
    code,
    // `exitCode` is an alias for `code` for better compatibility (issue #36)
    exitCode: code,
    stdout,
    stderr,
    stdin,
    text() {
      return Promise.resolve(stdout);
    },
  };
}

/**
 * Create an Error describing a command that exited with a failing status.
 *
 * The status is exposed under both `code` (command-stream's original name) and
 * `exitCode` (the name used by Node.js `child_process`, execa, zx, nano-spawn
 * and Bun Shell), so either error-handling style works (issue #38).
 *
 * @param {string} message - Error message
 * @param {object} params - Error parameters
 * @param {number} params.code - Exit code of the failed command
 * @param {string} [params.stdout] - Captured stdout
 * @param {string} [params.stderr] - Captured stderr
 * @param {object} [params.result] - Full result object of the failed command
 * @returns {Error & {code: number, exitCode: number}} Command failure error
 */
export function createCommandError(message, { code, stdout, stderr, result }) {
  const error = new Error(message);
  error.code = code;
  // `exitCode` is an alias for `code` for better compatibility (issue #38)
  error.exitCode = code;
  if (stdout !== undefined) {
    error.stdout = stdout;
  }
  if (stderr !== undefined) {
    error.stderr = stderr;
  }
  if (result !== undefined) {
    error.result = result;
  }
  return error;
}

/**
 * Expose the numeric exit status of a rejected command as `exitCode`.
 *
 * Failures that never reached a running process keep the POSIX errno string in
 * `code` (`ENOENT`, `EACCES`, ...) because that is what Node.js reports, so the
 * shell-compatible status is taken from the result the runner already built
 * (issue #38).
 *
 * @param {Error & {code?: string|number, exitCode?: number}} error - Thrown error
 * @param {number} code - Numeric exit status to expose
 * @returns {Error} The same error
 */
export function attachExitCodeAlias(error, code) {
  if (error && typeof error === 'object' && error.exitCode === undefined) {
    error.exitCode = code;
  }
  return error;
}

export function createCancelledResult(signal) {
  const signalCodes = { SIGINT: 130, SIGKILL: 137, SIGTERM: 143 };
  return createResult({
    code: signalCodes[signal] ?? 1,
    stdout: '',
    stderr: '',
    stdin: '',
  });
}

/**
 * Convert supported synchronous stdin values into spawn input.
 * @param {string|Buffer} stdin - Stdin option
 * @returns {Buffer|undefined} Spawn input
 */
export function getSyncStdinInput(stdin) {
  if (typeof stdin === 'string') {
    return Buffer.from(stdin);
  }
  return Buffer.isBuffer(stdin) ? stdin : undefined;
}

/**
 * Convert supported synchronous stdin values into result text.
 * @param {string|Buffer} stdin - Stdin option
 * @returns {string} Stdin text
 */
export function getStdinString(stdin) {
  if (typeof stdin === 'string') {
    return stdin;
  }
  return Buffer.isBuffer(stdin) ? stdin.toString('utf8') : '';
}

/**
 * Convert a process-launch error into a shell-compatible numeric status.
 * @param {Error & {code?: string|number}} error - Spawn/system error
 * @returns {number} Numeric process status
 */
export function executionErrorExitCode(error) {
  if (typeof error.code === 'number') {
    return error.code;
  }
  if (error.code === 'ENOENT') {
    return 127;
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return 126;
  }
  return 1;
}

export function isProcessLaunchError(error) {
  return (
    typeof error?.code === 'string' &&
    (error?.syscall?.includes('spawn') ||
      ['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC'].includes(error.code))
  );
}

export function prepareSpawnErrorResult(runner) {
  if (!runner._spawnError) {
    return undefined;
  }
  if (runner.options.capture && runner.errChunks.length === 0) {
    runner.errChunks.push(Buffer.from(runner._spawnError.message));
  }
  return executionErrorExitCode(runner._spawnError);
}

export function createExecutionErrorResult(error) {
  return createResult({
    code: executionErrorExitCode(error),
    stdout: error.stdout ?? '',
    stderr: error.stderr ?? error.message ?? '',
    stdin: '',
  });
}

export function finishExecutionError(runner, error) {
  if (runner.finished) {
    return runner.result;
  }

  return runner.finish(createExecutionErrorResult(error));
}
