// Differential test: command-stream interpolation vs POSIX sh "$var"
import { $ } from '../js/src/$.mjs';
import { execFileSync } from 'child_process';

const values = [
  '/Users/john/My Documents/report.txt',
  "/tmp/it's a dir/file.txt",
  '/tmp/quoted "name"/f.txt',
  "'/already/single quoted/path'",
  '"/already/double quoted/path"',
  '/tmp/back\\slash dir/f.txt',
  '/tmp/$HOME dir/f.txt',
  '/tmp/tab\there/f.txt',
  '/tmp/new\nline/f.txt',
  '  leading and trailing  ',
  '',
  '/tmp/glob*dir/f.txt',
  '/tmp/~tilde dir/f.txt',
  '/tmp/semi;colon dir/f.txt',
  '/tmp/(paren) dir/f.txt',
  '/tmp/emoji 🚀 dir/f.txt',
  'C:\\Program Files\\App\\app.exe',
];

function shArgs(value) {
  // What a POSIX shell gives argv when you write:  prog "$var"
  const script = 'printf "[%s]\\n" "$1"';
  return execFileSync('/bin/sh', ['-c', 'printf "[%s]\\n" "$V"'], {
    env: { ...process.env, V: value },
    encoding: 'utf8',
  });
}

let fails = 0;
for (const v of values) {
  const expected = shArgs(v);
  const built = $({ mirror: false })`printf ${{ raw: '"[%s]\\n"' }} ${v}`;
  let actual;
  try {
    actual = (await built).stdout;
  } catch (e) {
    actual = 'THREW ' + e.message;
  }
  const ok = actual === expected;
  if (!ok) {
    fails++;
  }
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} value=${JSON.stringify(v)}\n     built=${JSON.stringify(built.spec.command)}\n     sh   =${JSON.stringify(expected)}\n     cs   =${JSON.stringify(actual)}`
  );
}
console.log('failures:', fails, '/', values.length);
