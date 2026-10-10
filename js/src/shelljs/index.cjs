// The compatibility boundary uses pinned ShellJS rather than approximating its
// option objects, ShellString methods, globs, configuration or process state.
// Native command-stream APIs retain their separate streaming implementation.
'use strict';
const { createRequire } = require('node:module');
const { isAbsolute } = require('node:path');
const shellPath = require.resolve('shelljs');
// Local installs must patch ShellJS's own dependency, including non-hoisted
// trees. CDNs return a bare specifier (or URL) from require.resolve; their
// static require shim loads the same fast-glob that ShellJS imports.
const glob = isAbsolute(shellPath)
  ? createRequire(shellPath)('fast-glob')
  : require('fast-glob');
require('./glob-safety.cjs')(glob);
module.exports = require('shelljs');
