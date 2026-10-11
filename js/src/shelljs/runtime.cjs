'use strict';

// ESM entry points inject these imports so Node 22.0 can load the commands
// without require(esm). Direct CommonJS consumers use the normal synchronous
// bridge supported by Node 22.12 and newer, or Bun.
let globSync;
let cmdSync;

exports.configure = (runtime) => {
  globSync ??= runtime.globbySync;
  cmdSync ??= runtime.execaSync;
};

exports.globbySync = (...args) => {
  globSync ??= require('../zx/vendor/glob.mjs').globbySync;
  return globSync(...args);
};

exports.execaSync = (...args) => {
  cmdSync ??= require('execa').execaSync;
  return cmdSync(...args);
};
