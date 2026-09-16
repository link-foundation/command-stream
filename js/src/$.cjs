// command-stream - CommonJS entry point
//
// Issue #189: the package shipped only the ESM entry point, so a CommonJS host
// could reach the library exclusively through `await import('command-stream')`.
// That is asynchronous by definition and therefore unusable at a synchronous
// launch-time boundary, even though `ProcessRunner.sync()` itself is synchronous.
//
// This wrapper loads the single ESM module graph through `require(esm)`
// (Node.js >= 20.19.0 / >= 22.12.0, and Bun). Because the ESM graph is loaded by
// the same module registry that `import` uses, `require('command-stream')` and
// `import('command-stream')` share one instance: virtual command registrations,
// shell settings, and process cleanup state stay in sync. There is no second,
// bundled copy of the library and therefore no dual-package hazard.
//
// The exported value is the `$` tagged template function itself, with every
// named export attached to it, so both CommonJS shapes work:
//
//   const $ = require('command-stream');
//   const { $, sh, ProcessRunner } = require('command-stream');

'use strict';

const ESM_ENTRY = './$.mjs';

/**
 * Load the ESM entry point synchronously.
 *
 * Runtimes without `require(esm)` support throw ERR_REQUIRE_ESM, which is
 * opaque for consumers of this package; replace it with an actionable message.
 *
 * @returns {object} The `$.mjs` module namespace object.
 */
function loadEsmNamespace() {
  try {
    return require(ESM_ENTRY);
  } catch (error) {
    if (error && error.code === 'ERR_REQUIRE_ESM') {
      const runtime =
        typeof process !== 'undefined' && process.version
          ? ` (running ${process.version})`
          : '';
      throw new Error(
        'command-stream: require() of this package needs a runtime with ' +
          `require(esm) support - Node.js >= 20.19.0 or >= 22.12.0${runtime}. ` +
          "Upgrade Node.js, or load the package with `await import('command-stream')`.",
        { cause: error }
      );
    }
    throw error;
  }
}

const namespace = loadEsmNamespace();

/**
 * CommonJS view of the default export. It forwards to the ESM `$` instead of
 * being the very same function object, so attaching the named exports below
 * does not mutate the value seen by ESM consumers.
 *
 * @param {...*} args Tagged template arguments, or an options object.
 * @returns {*} A ProcessRunner, or an options-bound tagged template function.
 */
function $(...args) {
  return namespace.$(...args);
}

// Skipped keys: `$`/`default` are re-pointed at the wrapper below, and
// `__esModule` is a marker some runtimes add to require(esm) namespaces.
const RE_EXPORT_SKIP = new Set(['$', 'default', '__esModule']);

for (const name of Object.keys(namespace)) {
  if (RE_EXPORT_SKIP.has(name)) {
    continue;
  }
  Object.defineProperty($, name, {
    value: namespace[name],
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

Object.defineProperty($, '$', {
  value: $,
  enumerable: true,
  writable: true,
  configurable: true,
});

Object.defineProperty($, 'default', {
  value: $,
  enumerable: true,
  writable: true,
  configurable: true,
});

// Interop marker for transpiled `import $ from 'command-stream'` in CommonJS
// output; non-enumerable to match the shape emitted by TypeScript and Babel.
Object.defineProperty($, '__esModule', { value: true });

module.exports = $;
