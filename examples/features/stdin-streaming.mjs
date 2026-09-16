// .streams.stdin gives write access to a running command.
import { $ } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'stdin-streaming', title: 'Writing to stdin while a command runs' }, async ({ record }) => {
  const runner = $q`cat`;
  const stdin = await runner.streams.stdin;
  stdin.write('first line\n');
  stdin.write('second line\n');
  stdin.end();
  record('what cat echoed back', (await runner).stdout);

  // A whole string can also be handed over up front.
  record('stdin option', (await $({ mirror: false, stdin: 'up front\n' })`cat`).stdout);
});
