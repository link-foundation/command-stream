// The default `stdin: 'inherit'` must not be fed into a pipeline as data.
import { $, register, unregister } from '../js/src/$.mjs';
const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });
register('count-bytes', async ({ stdin }) => ({
  stdout: `bytes=${String(stdin ?? '').length}\n`,
  code: 0,
}));
console.log(
  `[${runtime}] echo hi | count-bytes ->`,
  JSON.stringify((await $q`echo hi | count-bytes`).stdout)
);
console.log(
  `[${runtime}] stdin option pipeline ->`,
  JSON.stringify(
    (await $({ mirror: false, capture: true, stdin: 'abc' })`cat | count-bytes`)
      .stdout
  )
);
unregister('count-bytes');
