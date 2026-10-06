import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import shelljs from '../src/shelljs/index.mjs';

const require = createRequire(import.meta.url);
const shellRequire = createRequire(require.resolve('shelljs'));
const glob = shellRequire('fast-glob');
const nested = (depth) => `${'{'.repeat(depth)}a,b${'}'.repeat(depth)}`;

test('ShellJS rejects deeply nested globs before the vulnerable recursive walker', () => {
  const experiment = fileURLToPath(
    new URL('../../experiments/shelljs-glob-depth.cjs', import.meta.url)
  );
  const result = spawnSync(
    'node',
    ['--max-old-space-size=64', '--stack-size=256', experiment, '--guard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 }
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('depth guard passed');
}, 5000);

test('guards arrays, ignore patterns and parentheses independently of configuration', () => {
  expect(() => glob.sync(['missing', nested(101)])).toThrow(/100 levels/);
  expect(() => glob.sync('*', { ignore: [nested(101)] })).toThrow(/100 levels/);
  expect(() => glob.globSync('(', { ignore: nested(101) })).toThrow(
    /100 levels/
  );
  expect(() => glob.sync(`${'('.repeat(101)}a${')'.repeat(101)}`)).toThrow(
    /100 levels/
  );
  const mixed = `${'{'.repeat(60)}${'('.repeat(41)}a,b${')'.repeat(41)}${'}'.repeat(60)}`;
  expect(() => glob.sync(mixed)).toThrow(/100 levels/);
  expect(() => glob.sync(nested(101), { braceExpansion: false })).toThrow(
    /100 levels/
  );
  expect(() => glob.sync('x'.repeat(10001))).toThrow(/10000 characters/);
  shelljs.config.reset();
  expect(() => glob.sync(nested(101))).toThrow(/100 levels/);
});

test('preserves normal brace globs and treats escaped, quoted and bracketed braces literally', () => {
  const directory = mkdtempSync(join(tmpdir(), 'command-stream-glob-'));
  try {
    writeFileSync(join(directory, 'a.txt'), 'a\n');
    writeFileSync(join(directory, 'b.txt'), 'b\n');
    const pattern = join(directory, '{a,b}.txt').replaceAll('\\', '/');
    expect(shelljs.ls(pattern).slice()).toEqual([
      join(directory, 'a.txt').replaceAll('\\', '/'),
      join(directory, 'b.txt').replaceAll('\\', '/'),
    ]);
    expect(() => glob.sync(nested(100), { cwd: directory })).not.toThrow();
    for (const pattern of [
      '\\{'.repeat(101),
      `"${'{'.repeat(101)}"`,
      `[${'{'.repeat(101)}]`,
      '{}'.repeat(101),
    ]) {
      expect(() => glob.sync(pattern, { cwd: directory })).not.toThrow();
    }
    // Text arguments never reach the glob dependency.
    expect(shelljs.ShellString(nested(101)).stdout).toBe(nested(101));
    // ls -R calls glob.sync directly after expansion's literal fallback.
    const literalDirectory = join(directory, nested(101));
    mkdirSync(literalDirectory);
    expect(() =>
      shelljs.ls('-R', literalDirectory.replaceAll('\\', '/'))
    ).toThrow(/100 levels/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
