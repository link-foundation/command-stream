// Pipelines mix built-ins, your own commands and real binaries freely.
import { $, register, unregister } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'pipelines', title: 'Pipelines' }, async ({ record }) => {
  register('upper', async ({ stdin }) => ({ stdout: String(stdin ?? '').toUpperCase(), code: 0 }));

  record('built-in into built-in', (await $q`seq 1 3 | cat`).stdout);
  record('built-in into your command', (await $q`echo hello | upper`).stdout);
  record('your command into a real binary', (await $q`echo hello | upper | tr A-Z a-z`).stdout);
  record('real binary into your command', (await $q`printf 'abc' | upper`).stdout);

  // The exit code of a pipeline is the exit code of its last stage.
  record('exit code of the last stage', (await $q`echo x | sh -c 'exit 7'`).code);
  record('an earlier failure does not change it', (await $q`sh -c 'exit 3' | cat`).code);

  // The .pipe() method builds the same pipeline from separate commands.
  const piped = await $({ mirror: false })`echo method`.pipe($({ mirror: false })`upper`);
  record('.pipe() method', piped.stdout);

  unregister('upper');
});
