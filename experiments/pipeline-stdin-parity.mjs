// Minimal reproduction: piping into a virtual command.
// Bun yields "ABC\n"; Node yields "INHERIT" (the literal default stdin option).
import { $, register, unregister } from '../src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });

register('upper', async ({ stdin }) => ({
  stdout: String(stdin ?? '').toUpperCase(),
  code: 0
}));

register('show-stdin', async ({ stdin }) => ({
  stdout: `stdin=${JSON.stringify(stdin)}\n`,
  code: 0
}));

console.log(`[${runtime}] echo abc | upper          ->`, JSON.stringify((await $q`echo abc | upper`).stdout));
console.log(`[${runtime}] echo abc | show-stdin     ->`, JSON.stringify((await $q`echo abc | show-stdin`).stdout));
console.log(`[${runtime}] seq 1 3 | show-stdin      ->`, JSON.stringify((await $q`seq 1 3 | show-stdin`).stdout));
console.log(`[${runtime}] sh -c echo | show-stdin   ->`, JSON.stringify((await $q`sh -c 'echo sys' | show-stdin`).stdout));
console.log(`[${runtime}] upper (no pipe)           ->`, JSON.stringify((await $q`upper`).stdout));

unregister('upper');
unregister('show-stdin');
