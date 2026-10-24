const sh = require('shelljs');
exports.original = true;
this.result = sh.exec('printf migrated', { silent: true }).stdout;
module.exports = this;
if (!module.exports.original) throw new Error('exports identity changed');
console.log(module.exports.result);
