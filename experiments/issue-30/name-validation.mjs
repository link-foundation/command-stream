import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import $, { create, listCommands } from '../../js/src/$.mjs';
import { create as coreCreate } from '../../js/src/core.mjs';

const commonJs = createRequire(import.meta.url)('../../js/src/$.cjs');
const coreCommonJs = createRequire(import.meta.url)('../../js/src/core.cjs');
const handler = () => ({ code: 0, stdout: 'hello' });
const names = [null, undefined, 42, true, {}, ['command']];
for (const register of [
  $.create,
  create,
  commonJs.create,
  coreCreate,
  coreCommonJs.create,
]) {
  for (const name of names) {
    const original = listCommands();
    assert.throws(() => register(name, handler), TypeError);
    assert.deepEqual(listCommands(), original);
  }
}
const quiet = create({ mirror: false });
assert.equal(await (await quiet`echo configured`).text(), 'configured\n');
console.log('Name validation passed through ESM and CommonJS');
