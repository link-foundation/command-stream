// Every result exposes an async text() method, like Bun's built-in $.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'result-text', title: 'Read the output with text()' }, async ({ record }) => {
  record('system command', await (await $q`sh -c 'echo system'`).text());
  record('built-in command', await (await $q`echo built-in`).text());
  record('synchronous command', await $q`echo sync`.sync().text());
  record('pipeline', await (await $q`echo piped | cat`).text());

  register('text-demo', async () => ({ stdout: 'virtual\n', code: 0 }));
  record('virtual command', await (await $q`text-demo`).text());
  unregister('text-demo');
});
