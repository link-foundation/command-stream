// Parity probe: exit code propagation out of pipelines.
import { $, register, unregister } from '../js/src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });

register('fail7', async () => ({ stdout: '', stderr: 'boom\n', code: 7 }));

const cases = {
  'virtual last fails': () => $q`echo a | fail7`,
  'virtual only fails': () => $q`fail7`,
  'system last fails': () => $q`echo a | sh -c 'exit 7'`,
  'builtin cat missing file': () => $q`echo a | cat /no/such/file`,
  'virtual first fails': () => $q`fail7 | cat`,
  'system first fails': () => $q`sh -c 'exit 7' | cat`,
};

for (const [label, run] of Object.entries(cases)) {
  const r = await run();
  console.log(
    `[${runtime}] ${label.padEnd(26)} code=${r.code} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr.trim())}`
  );
}

unregister('fail7');
