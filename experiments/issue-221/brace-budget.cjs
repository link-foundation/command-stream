'use strict';
// Finite pattern and expansion budget, tested with a 64 MiB heap / 256 KiB stack.
const assert = require('node:assert/strict');
const glob = require('../../js/src/shelljs/glob.cjs');
assert.throws(() => glob.sync('{a,b}'.repeat(15)), {
  name: 'SyntaxError',
  message: 'Glob brace expansion exceeds 10000 patterns',
});
console.log('brace expansion budget passed');
