// Shared CommonJS loader for the zx-compatible entry points (issue #26).
//
// Like ../$.cjs, the wrappers load the single ESM module graph through
// `require(esm)` (Node.js >= 20.19.0 / >= 22.12.0, and Bun), so `require` and
// `import` consumers share one `$` and one options store.

'use strict';

/**
 * Load a sibling ESM module synchronously and return a plain-object copy of its
 * namespace, the shape zx's own `.cjs` builds expose.
 *
 * @param {string} specifier Module path relative to this directory.
 * @returns {object} Named exports of the module.
 */
module.exports = function loadZxModule(specifier) {
  let namespace;
  try {
    namespace = require(specifier);
  } catch (error) {
    if (error && error.code === 'ERR_REQUIRE_ESM') {
      throw new Error(
        'command-stream/zx: require() needs a runtime with require(esm) ' +
          `support - Node.js >= 20.19.0 or >= 22.12.0 (running ${process.version}).`,
        { cause: error }
      );
    }
    throw error;
  }
  const exports = {};
  for (const name of Object.keys(namespace)) {
    if (name !== '__esModule' && name !== 'default') {
      exports[name] = namespace[name];
    }
  }
  return exports;
};
