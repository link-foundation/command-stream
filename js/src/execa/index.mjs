// The Execa 10.1.0 API, isolated from the native shell and virtual commands.
// Delegate to the pinned implementation so streams, IPC, errors and options
// retain their upstream behavior instead of approximating them with a shell.
import * as upstream from 'execa';

export * from 'execa';

// Execa 10 removed these helpers. Keep command-stream's public methods by
// using the upstream parser and process methods, including options presets.
function commandMethod(method) {
  return (...args) => {
    const [command, options] = args;
    if (typeof command === 'string') {
      const [file, ...argv] = upstream.parseCommandString(command);
      return method(file, argv, options);
    }
    if (command && !Array.isArray(command) && typeof command === 'object') {
      return commandMethod(method(command));
    }
    return method(...args);
  };
}

export const execaCommand = commandMethod(upstream.execa);
export const execaCommandSync = commandMethod(upstream.execaSync);
const compatible = { ...upstream, execaCommand, execaCommandSync };

/**
 * Create the compatibility API with reusable default execution options.
 * @param {object} options Execa options applied to each method.
 * @returns {object} An options-bound API.
 */
export function create(options = {}) {
  return bindApi(compatible, options);
}

// Let Execa merge nested env/fd options when rebinding, just as its presets do.
function bindApi(previous, options) {
  const methods = {};
  for (const name of [
    'execa',
    'execaSync',
    'execaNode',
    'execaCommand',
    'execaCommandSync',
    '$',
  ]) {
    methods[name] = previous[name](options);
  }
  return Object.freeze({
    ...upstream,
    ...methods,
    create: (overrides = {}) => bindApi(methods, overrides),
    isExecaChildProcess,
  });
}

/**
 * Identify a live Execa subprocess rather than any object with a pid.
 * @param {*} value Possible subprocess.
 * @returns {boolean} Whether it exposes Execa's subprocess methods.
 */
export function isExecaChildProcess(value) {
  return (
    value !== null &&
    value !== undefined &&
    typeof value.then === 'function' &&
    typeof value.kill === 'function' &&
    typeof value.iterable === 'function'
  );
}

const api = Object.freeze({ ...compatible, create, isExecaChildProcess });

/**
 * Access all Execa exports, optionally binding default execution options.
 * @param {object} [options] Default options.
 * @returns {object} The compatibility API.
 */
export function execaCompat(options) {
  return options === undefined ? api : create(options);
}
