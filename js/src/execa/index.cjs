'use strict';

// Use the same require(esm) boundary as the Bun and zx entry points.
try {
  module.exports = require('./index.mjs');
} catch (error) {
  if (error && error.code === 'ERR_REQUIRE_ESM') {
    throw new Error(
      'command-stream/execa: require() needs Node.js >= 20.19.0 or >= 22.12.0, or Bun. ' +
        "Upgrade Node.js, or use await import('command-stream/execa').",
      { cause: error }
    );
  }
  throw error;
}
