// command-stream/bun - CommonJS entry point.
//
// Loads the ESM module graph through `require(esm)` (Node.js >= 20.19.0 /
// >= 22.12.0, and Bun), like `src/$.cjs`, so both entry points share one
// instance. The exported value is the Bun.$-compatible `$` itself; its
// properties (`$.Shell`, `$.ShellError`, `$.escape`, ...) are Bun's, and the
// named exports are reachable as usual:
//
//   const { $ } = require('command-stream/bun');

'use strict';

function load() {
  try {
    return require('./bun.mjs');
  } catch (error) {
    if (error && error.code === 'ERR_REQUIRE_ESM') {
      throw new Error(
        'command-stream/bun: require() needs a runtime with require(esm) ' +
          `support - Node.js >= 20.19.0 or >= 22.12.0 (running ${process.version}). ` +
          "Upgrade Node.js, or use `await import('command-stream/bun')`.",
        { cause: error }
      );
    }
    throw error;
  }
}

const namespace = load();

module.exports = {
  $: namespace.$,
  default: namespace.$,
  Shell: namespace.Shell,
  ShellError: namespace.ShellError,
  ShellFile: namespace.ShellFile,
  ShellOutput: namespace.ShellOutput,
  ShellPromise: namespace.ShellPromise,
};
Object.defineProperty(module.exports, '__esModule', { value: true });
