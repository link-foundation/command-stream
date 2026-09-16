// Operators between commands: && runs on success, || runs on failure,
// ; runs unconditionally and ( ) groups commands into a subshell.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'sequences', title: 'Command sequences' }, async ({ record }) => {
  record('&& after a success', (await $q`true && echo ran`).stdout);
  record('&& after a failure', (await $q`false && echo ran`).stdout);
  record('|| after a failure', (await $q`false || echo fallback`).stdout);
  record('|| after a success', (await $q`true || echo fallback`).stdout);
  record('; runs both', (await $q`echo one ; echo two`).stdout);
  record('( ) groups commands', (await $q`(echo a ; echo b)`).stdout);

  const chain = await $q`false && echo skipped`;
  record('exit code of a short-circuited chain', chain.code);
});
