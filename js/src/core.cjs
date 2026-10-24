// CommonJS view of the shared lightweight ESM implementation (require(esm)).
'use strict';

const namespace = require('./core.mjs');

// Forward calls without attaching named exports to the ESM $ function.
function $(...args) {
  return namespace.$(...args);
}
for (const name of Object.keys(namespace)) {
  if (name !== '$' && name !== 'default' && name !== '__esModule') {
    Object.defineProperty($, name, {
      value: namespace[name],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
Object.assign($, { $, default: $ });
Object.defineProperty($, '__esModule', { value: true });
module.exports = $;
