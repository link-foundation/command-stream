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
    stdout,
    stderr,
    stdin,
    async text() {
      return stdout;
    },
  };
}
