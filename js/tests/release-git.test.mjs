import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stageReleaseMetadata,
  pushWithRetry,
  commitReleaseVersion,
} from '../scripts/release-git.mjs';

test('release commits preserve their message literally without shell parsing', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-commit-'));
  const original = process.cwd();
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(cwd, 'package.json'), '{}');
    git('add', 'package.json');
    process.chdir(cwd);
    const message = '1.4.1 "quoted" \\ literal $(echo unintended)';
    await commitReleaseVersion(message);
    expect(git('log', '-1', '--format=%B').trim()).toBe(message);
  } finally {
    process.chdir(original);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('release staging refuses unrelated tracked and untracked files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-metadata-'));
  const original = process.cwd();
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(cwd, 'package.json'), '{}');
    git('add', '.');
    git('commit', '-m', 'base');
    process.chdir(cwd);
    writeFileSync(join(cwd, 'package.json'), '{"version":"1.0.1"}');
    writeFileSync(join(cwd, 'unrelated.txt'), 'must never publish');
    expect(stageReleaseMetadata).toThrow('outside');
    expect(git('diff', '--cached', '--name-only').toString()).toBe('');
    rmSync(join(cwd, 'unrelated.txt'));
    stageReleaseMetadata();
    expect(git('diff', '--cached', '--name-only').toString().trim()).toBe(
      'package.json'
    );
    expect(readFileSync(join(cwd, 'package.json'), 'utf8')).toContain('1.0.1');
  } finally {
    process.chdir(original);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('release staging is safe to repeat after consuming a fragment', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-restaging-'));
  const original = process.cwd();
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    mkdirSync(join(cwd, '.changeset'));
    writeFileSync(join(cwd, 'package.json'), '{}');
    writeFileSync(join(cwd, '.changeset/release.md'), 'patch');
    git('add', '.');
    git('commit', '-qm', 'base');
    rmSync(join(cwd, '.changeset/release.md'));
    process.chdir(cwd);
    stageReleaseMetadata();
    stageReleaseMetadata();
    expect(git('diff', '--cached', '--name-only').trim()).toBe(
      '.changeset/release.md'
    );
  } finally {
    process.chdir(original);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('only a lost push race is rebased and retried', async () => {
  let pushes = 0;
  let rebases = 0;
  await pushWithRetry({
    push: async () =>
      ++pushes === 1
        ? { code: 1, stderr: 'updates were rejected (fetch first)' }
        : { code: 0 },
    rebase: async () => {
      rebases++;
    },
  });
  expect(pushes).toBe(2);
  expect(rebases).toBe(1);
});

test.each([
  'GH013: repository rule violations [rejected] (fetch first)',
  'authentication failed',
  'network unavailable',
])('push failure stops immediately: %s', async (stderr) => {
  let attempts = 0;
  await expect(
    pushWithRetry({
      push: async () => {
        attempts++;
        return { code: 1, stderr };
      },
      rebase: async () => {
        throw new Error('must not rebase');
      },
    })
  ).rejects.toThrow('Git push failed');
  expect(attempts).toBe(1);
});
