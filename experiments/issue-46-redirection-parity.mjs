#!/usr/bin/env node
// Issue #46: "silent failure" class of bugs.
//
// The report was about `git push ... 2>&1` returning exit code 0 with no
// output. The root cause is broader: a command whose first word is a built-in
// (virtual) command is dispatched to that built-in with the shell operators
// left in place as literal arguments, so the redirection silently does
// nothing. This script diffs command-stream against /bin/sh so any divergence
// in exit code, stdout, or files written is visible.
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { $ } from '../js/src/$.mjs';

const CASES = [
  // The originally reported shape.
  'exit 3 2>&1',
  'sh -c "echo err 1>&2; exit 7" 2>&1',
  'cd . && sh -c "exit 5" 2>&1',
  'git push origin nonexistent-remote-branch 2>&1',
  // Output redirection on a built-in.
  'echo hello > out.txt',
  'echo hello >> out.txt',
  'echo hello 1> out.txt',
  'pwd > out.txt',
  'true > out.txt',
  'seq 1 3 > out.txt',
  'basename /a/b > out.txt',
  // stderr redirection on a built-in.
  'echo hello 2> err.txt',
  'ls /definitely/missing/path 2>/dev/null',
  'ls /definitely/missing/path 2>&1',
  'cat /definitely/missing/path 2>/dev/null',
  // Input redirection.
  'cat < seed.txt',
  'cat 0< seed.txt',
  // Redirection combined with operators.
  'echo a > out.txt && echo b >> out.txt',
  'false > out.txt || echo fallback > out.txt',
  // Redirection targets that must not be treated as arguments.
  'echo one two > out.txt',
  // Quoted redirection characters are literal, not operators.
  'echo "a > b"',
  "echo 'a > b'",
];

let failures = 0;
for (const cmd of CASES) {
  const dirSh = mkdtempSync(join(tmpdir(), 'sh-'));
  const dirCs = mkdtempSync(join(tmpdir(), 'cs-'));
  for (const d of [dirSh, dirCs]) {
    writeFileSync(join(d, 'seed.txt'), 'seeded\n');
  }

  const sh = spawnSync('/bin/sh', ['-c', cmd], {
    cwd: dirSh,
    encoding: 'utf8',
  });
  const expected = { code: sh.status, stdout: sh.stdout };

  let actual;
  try {
    const r = await $({ cwd: dirCs, mirror: false })`${{ raw: cmd }}`;
    actual = { code: r.code, stdout: r.stdout };
  } catch (e) {
    actual = { code: e.code, stdout: e.stdout };
  }

  const shFiles = execSync('ls -1', { cwd: dirSh, encoding: 'utf8' }).trim();
  const csFiles = execSync('ls -1', { cwd: dirCs, encoding: 'utf8' }).trim();
  // The two runs use differently-named temp dirs, so `pwd` output must be
  // normalised before the captured files can be compared.
  const shOut = readAll(dirSh).replaceAll(dirSh, '<CWD>');
  const csOut = readAll(dirCs).replaceAll(dirCs, '<CWD>');

  const same =
    expected.code === actual.code &&
    expected.stdout.replaceAll(dirSh, '<CWD>') ===
      actual.stdout.replaceAll(dirCs, '<CWD>') &&
    shFiles === csFiles &&
    shOut === csOut;
  if (!same) {
    failures++;
  }
  console.log(`${same ? 'OK  ' : 'DIFF'} ${JSON.stringify(cmd)}`);
  if (!same) {
    console.log(
      `      sh: code=${expected.code} stdout=${JSON.stringify(expected.stdout)} files=${JSON.stringify(shFiles)} contents=${JSON.stringify(shOut)}`
    );
    console.log(
      `      cs: code=${actual.code} stdout=${JSON.stringify(actual.stdout)} files=${JSON.stringify(csFiles)} contents=${JSON.stringify(csOut)}`
    );
  }
  rmSync(dirSh, { recursive: true, force: true });
  rmSync(dirCs, { recursive: true, force: true });
}

function readAll(dir) {
  return execSync('for f in *; do echo "== $f"; cat "$f"; done', {
    cwd: dir,
    encoding: 'utf8',
    shell: '/bin/sh',
  });
}

console.log(`\n${failures} divergence(s) out of ${CASES.length}`);
process.exit(failures === 0 ? 0 : 1);
