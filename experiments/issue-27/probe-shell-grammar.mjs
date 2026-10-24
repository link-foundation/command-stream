// Probe which Bun Shell grammar features command-stream's $ handles, and how.
import { $ } from '../../js/src/$.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cs-probe-'));
writeFileSync(join(dir, 'a.txt'), 'A\n');
writeFileSync(join(dir, 'b.txt'), 'B\n');
const cmds = [
  'echo {a,b}c',
  'echo *.txt',
  'echo x$(echo y)z',
  'FOO=bar; echo $FOO',
  'FOO=baz node -e "console.log(process.env.FOO)"',
  'export FOO=q; echo $FOO',
  `node -e "console.error('err')" 2>&1`,
  'node -e "console.log(1)" 1>&2',
  'if true; then echo yes; else echo no; fi',
  '[[ -f a.txt ]] && echo file',
  '(echo a; echo b)',
  'echo a & echo b',
  'echo ~',
  'false; echo $?',
  'echo hi > out.txt; cat < out.txt',
  'echo a | cat | cat',
  'echo "$(echo nested "$(echo deep)")"',
  'echo $((1+2))',
  'cd /tmp && pwd',
  "echo 'single $FOO'",
  'echo **/*.txt',
  'seq 1 3',
  'ls',
  'basename /a/b.txt',
  'dirname /a/b.txt',
  'which node',
  'echo a && false || echo recovered',
  'test -f a.txt && echo tf',
  'echo `echo bt`',
  'echo a; exit 3; echo b',
];
for (const c of cmds) {
  try {
    const r = await $({ mirror: false, cwd: dir })([c]);
    console.log(
      c.padEnd(50),
      '=>',
      r.code,
      JSON.stringify(r.stdout),
      r.stderr ? 'ERR:' + JSON.stringify(r.stderr.slice(0, 80)) : ''
    );
  } catch (e) {
    console.log(c.padEnd(50), '!!', e.message.split('\n')[0]);
  }
}
