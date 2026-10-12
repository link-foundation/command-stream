// Also run with Node 22.0.0, or --no-experimental-require-module, to check that
// the ESM entry does not depend on synchronous loading of ESM from CommonJS.
import assert from 'node:assert/strict';
import shelljs from '../../js/src/shelljs/index.mjs';
import plugin from '../../js/src/shelljs/plugin.mjs';
import { $, shelljs as mainShelljs } from '../../js/src/$.mjs';

assert.equal(mainShelljs, shelljs);
assert.equal($.shelljs, shelljs);
assert.ok(
  shelljs.ls('js/src/shelljs/*.mjs').includes('js/src/shelljs/index.mjs')
);
assert.equal(
  shelljs.cmd(process.execPath, '-e', 'console.log("cmd-ok")').stdout,
  'cmd-ok\n'
);
plugin.register('esmConsumerTest', () => 'plugin-ok');
assert.equal(shelljs.esmConsumerTest().stdout, 'plugin-ok');
assert.equal(
  (await $({ mirror: false })`printf esm-core-ok`).stdout.toString(),
  'esm-core-ok'
);
console.log(
  'PASS: ESM core, ShellJS commands, globbing and plugins without require(esm)'
);
