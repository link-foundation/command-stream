// Probes which execution paths expose the documented `.text()` method on results.
import { $, register, unregister } from '../js/src/$.mjs';

const $q = $({ mirror: false, capture: true });
const report = (label, value) =>
  console.log(`${label.padEnd(34)} text(): ${typeof value.text}`);

report('system command (async)', await $q`sh -c 'echo system'`);
report('built-in command (async)', await $q`echo builtin`);
report('built-in command (sync)', $({ mirror: false })`echo builtin`.sync());
report(
  'system command (sync)',
  $({ mirror: false })`sh -c 'echo system'`.sync()
);
report('pipeline (async)', await $q`echo a | cat`);
report(
  '.pipe() method',
  await $({ mirror: false })`echo a`.pipe($({ mirror: false })`cat`)
);

register('probe-virtual', async () => ({ stdout: 'virtual\n', code: 0 }));
report('virtual command (async)', await $q`probe-virtual`);
unregister('probe-virtual');
