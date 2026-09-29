// Compare the JS brace-expansion port with Bun.$.braces on many patterns.
// Run with: bun experiments/issue-27/bun-shell-braces-diff.mjs
import { braces } from '../../js/src/bun-shell/braces.mjs';

const patterns = [
  'echo 123',
  'echo {123,456}',
  'echo {123,{456,789}}',
  'echo {123,{456,789},abc}',
  '{{d,e}{g,h}}',
  'pre{{a,b}{c,d}}post',
  '{a,{b,c}{d,e},f}',
  '{{a,b}{c,d}{e,f}}',
  '{x,a{,}b}',
  '{x,{a,}}z',
  '{x,{,a}}z',
  '{x,{,}}z',
  'a{b,c{d,}}e',
  'a{b,c{,d}}e',
  '{x,{a,,b}}',
  '{x,{a,b,}}',
  '{{a,},x}',
  'p{q,{r,}{s,}}t',
  '{1,{2,{3,{4,{5,{6,{7,{8,{9,{10,{11,{12,{13,{14,{15,{16,{17}}}}}}}}}}}}}}}}}',
  '',
  'lol {😂,🫵,🤣}',
  'x{a,{}}y',
  'p{q{},r}s',
  '{a,b{}}z',
  '{a,{}}z',
  'a{{,}}b',
  '{a,{b}}',
  '{a{b,c}}',
  '{{a,}{b,}}',
  '{foo},x',
  '{a},{b}',
  'a{b,{c,d}}e',
  '{a,b}',
  '}{,',
  '\\{a,b}',
  '{a\\,b,c}',
  'a\\',
  '{a,b',
  'a,b}',
  '{a,b}{c,d}',
  '{,}',
  '{}',
  '{a,b}{',
  '{{a,b}',
  '{a,b}}',
  'x{a,b}y{c,d}z',
  '{a,{b,{c,d}}}{e,f}',
];
let fail = 0;
for (const p of patterns) {
  for (const opts of [undefined, { tokenize: true }, { parse: true }]) {
    let want, got;
    try {
      want = JSON.stringify(Bun.$.braces(p, opts));
    } catch (e) {
      want = 'ERR ' + e.message;
    }
    try {
      got = JSON.stringify(braces(p, opts));
    } catch (e) {
      got = 'ERR ' + e.message;
    }
    if (want !== got) {
      fail++;
      console.log(
        'MISMATCH',
        JSON.stringify(p),
        JSON.stringify(opts),
        '\n  bun :',
        want,
        '\n  port:',
        got
      );
    }
  }
}
const deep = '{,'.repeat(100000) + '}'.repeat(50000);
try {
  braces(deep);
  console.log('deep expanded?!');
  fail++;
} catch (e) {
  console.log('deep:', e.message);
}
console.log(fail ? `${fail} mismatches` : 'all match');
// Unclosed-group rollback cases with nested balanced groups between opens.
for (const p of [
  '{a{b,c}{d,{e,f}x',
  '{{{a,b}c,d',
  '{x,{y{a,b},z',
  '{a,{b,c}{,',
  '}{{a,b},{c',
  '{,{,{,}',
]) {
  const want = JSON.stringify([
    Bun.$.braces(p),
    Bun.$.braces(p, { tokenize: true }),
  ]);
  const got = JSON.stringify([braces(p), braces(p, { tokenize: true })]);
  if (want !== got) {
    fail++;
    console.log('MISMATCH', p, want, got);
  }
}
console.log(
  fail ? `${fail} mismatches (incl. rollback)` : 'rollback cases match'
);
