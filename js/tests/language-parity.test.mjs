import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const parityScript = join(
  repoRoot,
  '.github',
  'scripts',
  'check-language-parity.sh'
);
const repositories = [];

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
}

function parityResult(changedFiles) {
  const directory = mkdtempSync(join(tmpdir(), 'command-stream-parity-'));
  repositories.push(directory);
  git(directory, 'init', '--initial-branch=main', '--quiet');
  git(directory, 'config', 'user.email', 'tests@command-stream.invalid');
  git(directory, 'config', 'user.name', 'command-stream tests');

  for (const path of [
    'js/src/.keep',
    'rust/src/.keep',
    'js/benchmarks/.keep',
    'rust/benchmarks/.keep',
  ]) {
    const absolute = join(directory, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'base\n');
  }
  git(directory, 'add', '.');
  git(directory, 'commit', '--quiet', '--message', 'base');
  git(directory, 'switch', '--quiet', '--create', 'feature');

  for (const path of changedFiles) {
    writeFileSync(join(directory, path), 'changed\n');
  }
  git(directory, 'add', '.');
  git(directory, 'commit', '--quiet', '--message', 'feature');

  return spawnSync('bash', [parityScript], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: 'main' },
  });
}

afterEach(() => {
  while (repositories.length > 0) {
    rmSync(repositories.pop(), { force: true, recursive: true });
  }
});

describe.skipIf(process.platform === 'win32')('language parity guard', () => {
  test.each([
    ['JavaScript source', 'js/src/.keep', 'Rust source'],
    ['Rust source', 'rust/src/.keep', 'JavaScript source'],
    ['JavaScript benchmarks', 'js/benchmarks/.keep', 'Rust benchmarks'],
    ['Rust benchmarks', 'rust/benchmarks/.keep', 'JavaScript benchmarks'],
  ])('%s-only changes fail', (_language, path, expectedMessage) => {
    const result = parityResult([path]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(expectedMessage);
  });

  test('paired benchmark changes pass', () => {
    const result = parityResult([
      'js/benchmarks/.keep',
      'rust/benchmarks/.keep',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Language parity check passed.');
  });

  test('a benchmark edit cannot stand in for a source implementation', () => {
    const result = parityResult(['js/src/.keep', 'rust/benchmarks/.keep']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Rust source');
  });
});
