import { test, expect } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script =
  process.env.VALIDATE_CHANGESET_SCRIPT ||
  resolve(import.meta.dir, '../scripts/validate-changeset.mjs');

function validate({ base = 'main', code = false, added = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'changeset-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'command-stream', version: '1.0.0' })
    );
    mkdirSync(join(cwd, '.changeset'));
    const fragment = '---\n"command-stream": patch\n---\n\nFix a bug.\n';
    writeFileSync(join(cwd, '.changeset/existing.md'), fragment);
    git('add', '.');
    git('commit', '-m', 'base');
    git(
      'update-ref',
      'refs/remotes/origin/main',
      git('rev-parse', 'HEAD').toString().trim()
    );
    if (code) {
      mkdirSync(join(cwd, 'src'));
    }
    writeFileSync(join(cwd, code ? 'src/code.mjs' : 'README.md'), 'change');
    if (added) {
      writeFileSync(join(cwd, '.changeset/added.md'), fragment);
    }
    git('add', '.');
    git('commit', '-m', 'change');
    return spawnSync('node', [script], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        GITHUB_BASE_REF: base,
        GITHUB_BASE_SHA: '',
        BASE_SHA: '',
        GITHUB_HEAD_SHA: 'HEAD',
        HEAD_SHA: '',
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('changeset check fails closed when the base is unavailable', () => {
  expect(validate({ base: 'missing', code: true }).status).not.toBe(0);
});
test('documentation changes do not require a release', () => {
  expect(validate().status).toBe(0);
});
test('code changes require a newly added fragment', () => {
  expect(validate({ code: true }).status).not.toBe(0);
  expect(validate({ code: true, added: true }).status).toBe(0);
});
