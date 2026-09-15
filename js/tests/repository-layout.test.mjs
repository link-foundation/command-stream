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

function getWorkflowJobBlock(workflow, jobName) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `  ${jobName}:`);

  if (start === -1) {
    throw new Error(`Workflow job not found: ${jobName}`);
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line)
  );

  return lines.slice(start, nextJob === -1 ? lines.length : nextJob).join('\n');
}

function withCrlfLineEndings(text) {
  return text.replace(/\r?\n/g, '\r\n');
}

describe('repository language layout', () => {
  test('keeps JavaScript package files inside js/', () => {
    expect(existsFromRepo('package.json')).toBe(false);
    expect(existsFromRepo('package-lock.json')).toBe(false);
    expect(existsFromRepo('bun.lock')).toBe(false);
    expect(existsFromRepo('bunfig.toml')).toBe(false);
    expect(existsFromRepo('.changeset/config.json')).toBe(false);

    expect(existsFromRepo('js/package.json')).toBe(true);
    expect(existsFromRepo('js/package-lock.json')).toBe(true);
    expect(existsFromRepo('js/bun.lock')).toBe(true);
    expect(existsFromRepo('js/bunfig.toml')).toBe(true);
    expect(existsFromRepo('js/eslint.config.js')).toBe(true);
    expect(existsFromRepo('js/.changeset/config.json')).toBe(true);
    expect(existsFromRepo('js/scripts/publish-to-npm.mjs')).toBe(true);
  });

  test('lints and formats from the repository root, not from js/', () => {
    // eslint and prettier both treat the directory holding their configuration
    // as the base path of the linted project. While these files lived in js/,
    // repository-root JavaScript (claude-profiles.mjs, experiments/) was outside
    // that base path and silently unlintable, and js/.prettierignore's
    // docs/case-studies/**/{data,templates}/** patterns resolved against js/,
    // where no such directories exist -- the archived evidence they were meant
    // to protect is under the repository-root docs/. The root copies are what
    // put the whole tree in scope; js/eslint.config.js stays as the rule set
    // they re-export.
    expect(existsFromRepo('eslint.config.js')).toBe(true);
    expect(existsFromRepo('.prettierrc')).toBe(true);
    expect(existsFromRepo('.prettierignore')).toBe(true);
    expect(existsFromRepo('.lintstagedrc.json')).toBe(true);

    expect(existsFromRepo('js/.prettierrc')).toBe(false);
    expect(existsFromRepo('js/.prettierignore')).toBe(false);
    expect(existsFromRepo('js/.lintstagedrc.json')).toBe(false);

    expect(readFromRepo('eslint.config.js')).toContain(
      "export { default } from './js/eslint.config.js'"
    );
  });

  test('does not keep language release scripts at the repository root', () => {
    expect(existsFromRepo('scripts')).toBe(false);
    expect(existsFromRepo('scripts/publish-to-npm.mjs')).toBe(false);
    expect(existsFromRepo('scripts/publish-to-crates.mjs')).toBe(false);
    expect(existsFromRepo('scripts/sync-rust-version.mjs')).toBe(false);

    expect(existsFromRepo('js/scripts/version-and-commit.mjs')).toBe(true);
    expect(existsFromRepo('js/scripts/publish-to-npm.mjs')).toBe(true);
    expect(existsFromRepo('rust/scripts/version-and-commit.rs')).toBe(true);
    expect(existsFromRepo('rust/scripts/publish-crate.rs')).toBe(true);
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

  test('release jobs evaluate after PR-only gate jobs are skipped on push', () => {
    // A release job needs an `if:` that is not `success()`, or GitHub skips it
    // whenever a dependency was skipped -- which is exactly what happens to the
    // PR-only gate jobs on a push to main. `!cancelled()` lifts that implicit
    // requirement on its own; `always() && !cancelled()` reads as if it did
    // something more, but `always()` is subsumed by the operand next to it and
    // only invites `always()` being kept when the `!cancelled()` half is edited
    // away, at which point a cancelled run would still publish.
    const jsWorkflow = readFromRepo('.github/workflows/js.yml');
    const rustWorkflow = readFromRepo('.github/workflows/rust.yml');

    for (const [jsWorkflowVariant, rustWorkflowVariant] of [
      [jsWorkflow, rustWorkflow],
      [withCrlfLineEndings(jsWorkflow), withCrlfLineEndings(rustWorkflow)],
    ]) {
      const jsReleaseJob = getWorkflowJobBlock(jsWorkflowVariant, 'release');
      const rustReleaseJob = getWorkflowJobBlock(
        rustWorkflowVariant,
        'release'
      );

      expect(jsReleaseJob).toContain('needs: [lint, test]');
      expect(jsReleaseJob).toContain('!cancelled()');
      expect(jsReleaseJob).not.toContain('always()');
      expect(jsReleaseJob).toContain("github.ref == 'refs/heads/main'");
      expect(jsReleaseJob).toContain("github.event_name == 'push'");
      expect(jsReleaseJob).toContain("needs.lint.result == 'success'");
      expect(jsReleaseJob).toContain("needs.test.result == 'success'");

      expect(rustReleaseJob).toContain('needs: [lint, test, scripts, build]');
      expect(rustReleaseJob).toContain('!cancelled()');
      expect(rustReleaseJob).not.toContain('always()');
      expect(rustReleaseJob).toContain("github.ref == 'refs/heads/main'");
      expect(rustReleaseJob).toContain("github.event_name == 'push'");
      expect(rustReleaseJob).toContain("needs.lint.result == 'success'");
      expect(rustReleaseJob).toContain("needs.test.result == 'success'");
      expect(rustReleaseJob).toContain("needs.scripts.result == 'success'");
      expect(rustReleaseJob).toContain("needs.build.result == 'success'");
    }
  });

  test('keeps root README focused on shared project information', () => {
    const rootReadme = readFromRepo('README.md');

    expect(rootReadme).toContain('[JavaScript package](./js/README.md)');
    expect(rootReadme).toContain('[Rust crate](./rust/README.md)');
    expect(rootReadme).not.toContain('npm install command-stream');
    expect(rootReadme).not.toContain('cargo add command-stream');
  });
});
