// Interpolated values are quoted automatically, so user input cannot turn into
// extra shell syntax.
import { $, quote, raw } from '../../src/$.mjs';
import { example } from './_harness.mjs';

const $q = $({ mirror: false });

await example({ id: 'interpolation', title: 'Safe interpolation' }, async ({ record }) => {
  const name = "it's a name";
  record('quotes are handled', (await $q`echo ${name}`).stdout);

  const dangerous = 'hello; rm -rf /tmp/nothing';
  record('injection stays one argument', (await $q`echo ${dangerous}`).stdout);

  const args = ['one', 'two three'];
  record('an array becomes separate arguments', (await $q`echo ${args}`).stdout);

  record('quote() shows what interpolation does', quote("it's a name"));

  // raw() opts out of quoting when you really mean shell syntax.
  record('raw() keeps shell syntax', (await $q`echo ${raw('a b')}`).stdout);
});
