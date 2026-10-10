// Compare the compatibility glob boundary with ShellJS's pinned engine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const local = require('../../js/src/shelljs/glob.cjs');
const shellRequire = createRequire(
  require.resolve('../../js/node_modules/shelljs')
);
const upstream = shellRequire('fast-glob');
const cwd = mkdtempSync(join(tmpdir(), 'command-stream-glob-parity-'));
try {
  for (const name of [
    'a.txt',
    'b.txt',
    '.hidden',
    'dir/a.txt',
    'dir/deep/b.txt',
    'dir/a.js',
    '{a,b}.txt',
    '{a}.txt',
    '{b}.txt',
    'quoted/a.txt',
    "a'quote.txt",
    // Windows filenames cannot contain a double quote.
    ...(process.platform === 'win32' ? [] : ['a"quote.txt']),
  ]) {
    mkdirSync(join(cwd, name, '..'), { recursive: true });
    writeFileSync(join(cwd, name), name);
  }
  const cases = [
    ['*', {}],
    ['**/*.txt', {}],
    ['**/*.txt', { globstar: false }],
    ['dir/**/*.txt', { globstar: false }],
    ['**/*.txt', { globstar: false, ignore: ['**/a.txt'] }],
    [['**/*.txt', '!**/a.txt'], { globstar: false }],
    ['*', { onlyFiles: false }],
    ['dir', { onlyFiles: false }],
    ['{a,b}.txt', {}],
    ['{{a,b}}.txt', {}],
    ['{{a,b},missing}.txt', {}],
    ['{a,{b,missing}}.txt', {}],
    ['{a}.txt', {}],
    ['\\{a,b\\}.txt', {}],
    ['{a,b}.txt', { braceExpansion: false }],
    ['@(a|b).txt', {}],
    ['@(a|b).txt', { extglob: false }],
    ['*.TXT', { caseSensitiveMatch: false }],
    ['**', { dot: true, onlyDirectories: true, markDirectories: true }],
    ['**', { ignore: ['dir/**'], onlyFiles: false }],
    ['*.txt', { baseNameMatch: true }],
    ['"{a,b}".txt', {}],
    ["a'quote.txt", {}],
    ...(process.platform === 'win32' ? [] : [['a"quote.txt', {}]]),
    ['[{a,b}]*', {}],
  ];
  let failed = 0;
  for (const [pattern, options] of cases) {
    const actual = local.sync(pattern, { cwd, ...options }).sort();
    const expected = upstream.sync(pattern, { cwd, ...options }).sort();
    try {
      assert.deepEqual(actual, expected);
      console.log('PASS', pattern, JSON.stringify(options));
    } catch {
      failed++;
      console.error(JSON.stringify({ pattern, options, actual, expected }));
    }
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
