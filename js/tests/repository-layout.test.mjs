import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const jsRoot = resolve(testDir, '..');
const repoRoot = resolve(jsRoot, '..');

function existsFromRepo(relativePath) {
  return existsSync(resolve(repoRoot, relativePath));
}

function readFromRepo(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('repository language layout', () => {
  test('keeps JavaScript package files inside js/', () => {
    expect(existsFromRepo('package.json')).toBe(false);
    expect(existsFromRepo('package-lock.json')).toBe(false);
    expect(existsFromRepo('bun.lock')).toBe(false);
    expect(existsFromRepo('bunfig.toml')).toBe(false);
    expect(existsFromRepo('eslint.config.js')).toBe(false);
    expect(existsFromRepo('.changeset/config.json')).toBe(false);

    expect(existsFromRepo('js/package.json')).toBe(true);
    expect(existsFromRepo('js/package-lock.json')).toBe(true);
    expect(existsFromRepo('js/bun.lock')).toBe(true);
    expect(existsFromRepo('js/bunfig.toml')).toBe(true);
    expect(existsFromRepo('js/eslint.config.js')).toBe(true);
    expect(existsFromRepo('js/.changeset/config.json')).toBe(true);
    expect(existsFromRepo('js/scripts/publish-to-npm.mjs')).toBe(true);
  });

  test('keeps Rust package release files inside rust/', () => {
    expect(existsFromRepo('rust/Cargo.toml')).toBe(true);
    expect(existsFromRepo('rust/Cargo.lock')).toBe(true);
    expect(existsFromRepo('rust/README.md')).toBe(true);
    expect(existsFromRepo('rust/CHANGELOG.md')).toBe(true);
    expect(existsFromRepo('rust/scripts/publish-crate.rs')).toBe(true);
    expect(existsFromRepo('rust/changelog.d/README.md')).toBe(true);
  });

  test('uses separate JavaScript and Rust workflows and release tags', () => {
    expect(existsFromRepo('.github/workflows/release.yml')).toBe(false);
    expect(existsFromRepo('.github/workflows/js.yml')).toBe(true);
    expect(existsFromRepo('.github/workflows/rust.yml')).toBe(true);

    const jsWorkflow = readFromRepo('.github/workflows/js.yml');
    const rustWorkflow = readFromRepo('.github/workflows/rust.yml');

    expect(jsWorkflow).toContain('working-directory: js');
    expect(jsWorkflow).toContain('--tag-prefix js-v');
    expect(rustWorkflow).toContain('working-directory: rust');
    expect(rustWorkflow).toContain('--tag-prefix rust-v');
  });

  test('keeps root README focused on shared project information', () => {
    const rootReadme = readFromRepo('README.md');

    expect(rootReadme).toContain('[JavaScript package](./js/README.md)');
    expect(rootReadme).toContain('[Rust crate](./rust/README.md)');
    expect(rootReadme).not.toContain('npm install command-stream');
    expect(rootReadme).not.toContain('cargo add command-stream');
  });
});
