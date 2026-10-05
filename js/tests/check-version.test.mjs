import { test, expect } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script =
  process.env.CHECK_VERSION_SCRIPT ||
  resolve(import.meta.dir, '../scripts/check-version.mjs');

function checkVersion({ version = '1.0.0', indent = 2, base = 'main' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'check-version-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    );
    git('add', '.');
    git('commit', '-m', 'base');
    git(
      'update-ref',
      'refs/remotes/origin/main',
      git('rev-parse', 'HEAD').toString().trim()
    );
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'test', version }, null, indent)
    );
    git('add', '.');
    git('commit', '--allow-empty', '-m', 'change');
    return spawnSync('node', [script], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_BASE_REF: base,
        GITHUB_HEAD_REF: 'test',
        GITHUB_HEAD_SHA: 'HEAD',
        GITHUB_BASE_SHA: '',
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('issue #209: a manual version change fails', () => {
  expect(checkVersion({ version: '2.0.0' }).status).not.toBe(0);
});

test('issue #209: formatting without changing the version passes', () => {
  expect(checkVersion({ indent: 4 }).status).toBe(0);
});

test('issue #209: an unavailable base fails instead of reporting no changes', () => {
  expect(checkVersion({ base: 'missing' }).status).not.toBe(0);
});
