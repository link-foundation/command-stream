'use strict';

// Bound this advisory reproduction to a 64 MiB heap, 256 KiB stack and a
// 6,003-character pattern: node --max-old-space-size=64 --stack-size=256
// experiments/shelljs-glob-depth.cjs [--guard]
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const shellRequire = createRequire(
  require.resolve('../js/node_modules/shelljs')
);
const glob = shellRequire('fast-glob');
if (process.argv.includes('--guard')) {
  require('../js/src/shelljs/index.cjs');
}
const pattern = '{'.repeat(3000) + 'a,b' + '}'.repeat(3000);
assert.throws(
  () => glob.sync(pattern),
  process.argv.includes('--guard')
    ? { name: 'SyntaxError', code: 'ERR_SHELLJS_GLOB_DEPTH' }
    : { name: 'RangeError' }
);
console.log(
  process.argv.includes('--guard')
    ? 'depth guard passed'
    : 'stack exhaustion reproduced'
);
