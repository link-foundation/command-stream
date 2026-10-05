// The compatibility boundary uses pinned ShellJS rather than approximating its
// option objects, ShellString methods, globs, configuration or process state.
// Native command-stream APIs retain their separate streaming implementation.
'use strict';
const { createRequire } = require('node:module');
const shellRequire = createRequire(require.resolve('shelljs'));
require('./glob-safety.cjs')(shellRequire('fast-glob'));
module.exports = require('shelljs');
