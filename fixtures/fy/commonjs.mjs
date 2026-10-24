#!/usr/bin/env node
import { createRequire as __fyRequire } from 'node:module';
import { fileURLToPath as __fyPath } from 'node:url';
import { dirname as __fyDir } from 'node:path';
const __fyModule = { exports: {} };
(function (require, module, exports, __filename, __dirname) {
const sh = require("command-stream/shelljs");
exports.original = true;
this.result = sh.exec('printf migrated', { silent: true }).stdout;
module.exports = this;
if (!module.exports.original) throw new Error('exports identity changed');
console.log(module.exports.result);

}).call(__fyModule.exports, __fyRequire(import.meta.url), __fyModule, __fyModule.exports, __fyPath(import.meta.url), __fyDir(__fyPath(import.meta.url)));
export default __fyModule.exports;
