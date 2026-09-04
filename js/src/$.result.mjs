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

export function createCancelledResult(signal) {
  const signalCodes = { SIGINT: 130, SIGKILL: 137, SIGTERM: 143 };
  return createResult({
    code: signalCodes[signal] ?? 1,
    stdout: '',
    stderr: '',
    stdin: '',
  });
}

export function finishExecutionError(runner, error) {
  if (runner.finished) {
    return;
  }

  runner.finish(
    createResult({
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
      stdin: '',
    })
  );
}
