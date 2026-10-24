// Random differential fuzzing of the JS lexer/parser port against Bun.$
// (which parses synchronously and throws on syntax errors).
// Run with: bun experiments/issue-27/bun-shell-parse-fuzz.mjs [iterations] [seed]
import { buildShellSource } from '../../js/src/bun-shell/template.mjs';
import { parse } from '../../js/src/bun-shell/parser.mjs';

const iterations = Number(process.argv[2] ?? 20000);
let seed = Number(process.argv[3] ?? 1);
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rand() * a.length)];
const pieces = [
  'echo',
  ' ',
  ' ',
  ' ',
  'a',
  'b',
  'x=1',
  'FOO=bar',
  '$FOO',
  '${FOO}',
  '$1',
  '$?',
  '$@',
  '$',
  '"',
  "'",
  '\\',
  '\\\n',
  '|',
  '||',
  '&&',
  '&',
  ';',
  '\n',
  '(',
  ')',
  '$(',
  '`',
  '{',
  '}',
  ',',
  '*',
  '**',
  '?',
  '[',
  ']',
  '~',
  '#',
  '=',
  '>',
  '>>',
  '<',
  '2>',
  '&>',
  '2>&1',
  '1>&2',
  '>&2',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  '[[',
  ']]',
  '-f',
  '-z',
  '-n',
  '==',
  '!=',
  '-eq',
  '!',
  'true',
  'false',
  '\t',
  '"a b"',
  "'c d'",
  '\x08',
  'é',
  '😂',
  '0',
  '9',
  ':',
  '.',
  '/',
  '-',
];
const vals = [
  'a b',
  '',
  'if',
  'x',
  '$HOME',
  '1',
  [1, 'a'],
  { raw: '|' },
  { raw: '$(' },
  Buffer.from('z'),
];
const outcome = (f) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return `ERR ${e.message}`;
  }
};
let fail = 0;
const stats = {};
for (let it = 0; it < iterations; it++) {
  const nParts = 1 + Math.floor(rand() * 3);
  const raw = [];
  const values = [];
  for (let p = 0; p < nParts; p++) {
    let s = '';
    const n = Math.floor(rand() * 10);
    for (let k = 0; k < n; k++) {
      s += pick(pieces);
    }
    raw.push(s);
    if (p < nParts - 1) {
      values.push(pick(vals));
    }
  }
  const strings = Object.assign([...raw], { raw: [...raw] });
  const want = outcome(() => Bun.$(strings, ...values));
  const got = outcome(() => {
    const src = buildShellSource(raw, values);
    parse(src.script, src.jsstrings, src.jsobjs.length);
  });
  stats[want === 'ok' ? 'ok' : want.slice(0, 40)] =
    (stats[want === 'ok' ? 'ok' : want.slice(0, 40)] ?? 0) + 1;
  if (want !== got) {
    fail++;
    if (fail <= 30) {
      console.log(
        `MISMATCH ${JSON.stringify(raw)} ${JSON.stringify(values.map(String))}\n  bun : ${want.slice(0, 200)}\n  port: ${got.slice(0, 200)}`
      );
    }
  }
}
console.log(
  Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
);
console.log(`${iterations} scripts, ${fail} mismatches`);
