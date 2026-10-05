// Compare the JS template-assembly port with Bun's own error behaviour and
// `$.escape`. Run with: bun experiments/issue-27/bun-shell-template-diff.mjs
import {
  buildShellSource,
  shellEscape,
} from '../../js/src/bun-shell/template.mjs';

const tag = (s, ...v) => buildShellSource(s.raw, v);
const outcome = (f) => {
  try {
    const r = f();
    return r && typeof r.then === 'function' ? 'ok' : JSON.stringify(r);
  } catch (e) {
    return `ERR ${e.name} ${e.code ?? ''} ${e.message}`;
  }
};
const values = [
  new Date(0),
  new Error('boom'),
  new Map(),
  function foo() {},
  () => 1,
  {
    toString() {
      return 'custom';
    },
  },
  new String('s x'),
  new Number(5),
  new (class A {})(),
  new (class B {
    toString() {
      return 'B!';
    }
  })(),
  new URL('http://x/y z'),
  Promise.resolve(1),
  /a b/,
  Object(Symbol('q')),
  Symbol('p'),
  10n,
  -1,
  NaN,
  null,
  undefined,
  true,
  Object.create({
    toString() {
      return 'inh';
    },
  }),
  { toString: 5 },
  [],
  // eslint-disable-next-line no-sparse-arrays -- holes are part of the probe
  [1, , 2],
  {
    valueOf() {
      return 7;
    },
  },
  {
    [Symbol.toPrimitive]() {
      return 'prim';
    },
  },
  Object.create(null),
  'a\0b',
  { raw: 'a\0b' },
  '\ud800',
  { raw: '' },
  { raw: 0 },
  Object.create({ raw: 'x' }),
  { raw: null },
  { raw: undefined },
  { raw: false },
  {
    get raw() {
      return 'g';
    },
  },
];
let fail = 0;
for (const v of values) {
  const want = outcome(() => Bun.$`echo ${v}`);
  const got = outcome(() => tag`echo ${v}`);
  const bunOk = want === 'ok';
  const portOk = !got.startsWith('ERR');
  if (bunOk !== portOk || (!bunOk && want !== got)) {
    fail++;
    console.log(
      'MISMATCH',
      String(typeof v === 'symbol' ? 'symbol' : outcome(() => String(v))),
      '\n  bun :',
      want,
      '\n  port:',
      got
    );
  }
}
for (const v of [
  'abc',
  'a b',
  '',
  'if',
  'a$b`c"d\\e',
  'a\x08b c',
  5,
  'a\0b',
  {},
  'é',
  'ab_1',
  '~x',
]) {
  const want = outcome(() => Bun.$.escape(v));
  const got = outcome(() => shellEscape(v));
  if (want !== got) {
    fail++;
    console.log('ESCAPE MISMATCH', JSON.stringify(v), want, got);
  }
}
if (outcome(() => Bun.$.escape()) !== outcome(() => shellEscape())) {
  fail++;
  console.log('escape() mismatch');
}
let deep = 'x';
for (let i = 0; i < 101; i++) {
  deep = [deep];
}
if (outcome(() => Bun.$`echo ${deep}`) !== outcome(() => tag`echo ${deep}`)) {
  fail++;
  console.log('depth mismatch');
}
console.log(
  JSON.stringify(
    tag`FOO=bar; echo $FOO${'x'} $${'FOO'} ${1}${2} ${'if'} ${[1, [2, 'a b']]} ${{ raw: '$HOME' }}`
  )
);
console.log(fail ? `${fail} mismatches` : 'all match');
