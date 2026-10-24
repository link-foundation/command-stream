// Compares how an interpolated value with a single quote reaches a command.
// A real shell prints the value unchanged; the built-in path used to leak the
// quoting that command-stream added.
import {
  $,
  quote,
  enableVirtualCommands,
  disableVirtualCommands,
} from '../js/src/$.mjs';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const $q = $({ mirror: false, capture: true });
const name = "it's a name";
const withSpaces = 'two  spaces';

console.log(
  `[${runtime}] quote()              ->`,
  JSON.stringify(quote(name))
);
enableVirtualCommands();
console.log(
  `[${runtime}] built-in echo        ->`,
  JSON.stringify((await $q`echo ${name}`).stdout)
);
console.log(
  `[${runtime}] built-in echo spaces ->`,
  JSON.stringify((await $q`echo ${withSpaces}`).stdout)
);
console.log(
  `[${runtime}] built-in cat arg     ->`,
  JSON.stringify((await $q`echo ${name} | cat`).stdout)
);
disableVirtualCommands();
console.log(
  `[${runtime}] system echo          ->`,
  JSON.stringify((await $q`echo ${name}`).stdout)
);
console.log(
  `[${runtime}] system echo spaces   ->`,
  JSON.stringify((await $q`echo ${withSpaces}`).stdout)
);
enableVirtualCommands();
