// The compatibility boundary uses pinned ShellJS rather than approximating its
// option objects, ShellString methods, globs, configuration or process state.
// Native command-stream APIs retain their separate streaming implementation.
'use strict';
module.exports = require('shelljs');
