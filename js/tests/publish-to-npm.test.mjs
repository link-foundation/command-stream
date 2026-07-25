// Regression tests for js/scripts/publish-to-npm.mjs
//
// Issue #166: the release workflow created a GitHub release (`js-v0.10.1`) for a
// version that was never published to npm. Root cause: command-stream's `$`
// does not throw on a non-zero exit code (errexit is off by default, see #156),
// so the old publish loop's try/catch never observed the failed
// `changeset publish` and unconditionally emitted `published=true`, which gated
// the GitHub-release step.
//
// These tests run the real script against a throwaway package whose
// `changeset:publish` we control, and assert that a failed (or no-op) publish
// never produces `published=true`.

import { test, expect, beforeAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../scripts/publish-to-npm.mjs');

// The script hardcodes PACKAGE_NAME = 'command-stream' for its npm-view checks.
// Pick a version that definitely does not exist on npm so the "already
// published?" pre-check returns 404 and the script proceeds to publish.
const UNPUBLISHED_VERSION = '99.99.99-issue166-test';

// A real, long-published version so the "already published?" pre-check finds it.
const ALREADY_PUBLISHED_VERSION = '0.9.5';

// This is a subprocess + network integration test: each case spawns the real
// publish-to-npm.mjs, which downloads use-m from unpkg, loads command-stream,
// and hits the npm registry. On Windows runners the npm/network cold start is
// slow and command-stream's shell parsing differs, which makes it flaky; we run
// the regression coverage on Linux and macOS (both exercise the same code) and
// skip Windows. See docs/case-studies/issue-166/README.md.
const isWindows = process.platform === 'win32';

let networkAvailable = !isWindows;

beforeAll(() => {
  // Skip the probe entirely on Windows so this hook can never exceed the suite's
  // global test timeout (the per-test timeout does not apply to hooks).
  if (isWindows) {
    return;
  }
  // The script loads use-m + command-stream from unpkg/npm at runtime and the
  // npm-view checks hit the registry. Skip gracefully when offline. Keep the
  // probe timeout below the suite's global --timeout so the hook never trips it.
  try {
    const probe = spawnSync('npm', ['view', 'command-stream', 'version'], {
      encoding: 'utf8',
      timeout: 8000,
    });
    networkAvailable = probe.status === 0;
  } catch {
    networkAvailable = false;
  }
});

/**
 * Run publish-to-npm.mjs in an isolated temp package.
 * @param {object} opts
 * @param {string} opts.version - version written to the temp package.json
 * @param {string} opts.publishScript - the `changeset:publish` npm script body
 * @returns {{status:number, stdout:string, stderr:string, output:string}}
 */
function runPublish({ version, publishScript }) {
  const dir = mkdtempSync(join(tmpdir(), 'issue166-publish-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'command-stream',
        version,
        scripts: { 'changeset:publish': publishScript },
      },
      null,
      2
    )
  );
  const outputFile = join(dir, 'gh-output.txt');
  writeFileSync(outputFile, '');

  const res = spawnSync('bun', [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      PUBLISH_RETRY_DELAY: '0',
      PUBLISH_VERIFY_DELAY: '0',
    },
  });

  const output = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    output,
  };
}

test('does NOT report published when changeset:publish fails (exit 1)', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  const { status, output } = runPublish({
    version: UNPUBLISHED_VERSION,
    // Mimic the real failure: print a changeset-style error, then exit 1.
    publishScript:
      'node -e "console.error(\'an error occurred while publishing\'); process.exit(1)"',
  });

  expect(output).not.toContain('published=true');
  expect(output).toContain('published=false');
  expect(status).not.toBe(0);
}, 130000);

test('does NOT report published when changeset:publish exits 0 but nothing reaches npm', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  // The dangerous case: the publish command "succeeds" (exit 0, no error text)
  // but the version is not actually on npm. Layer 3 (npm view verification)
  // must catch this and refuse to emit published=true.
  const { status, output } = runPublish({
    version: UNPUBLISHED_VERSION,
    publishScript:
      'node -e "console.log(\'no projects to publish\'); process.exit(0)"',
  });

  expect(output).not.toContain('published=true');
  expect(output).toContain('published=false');
  expect(status).not.toBe(0);
}, 130000);

test('reports published for a version already on npm (legit success path)', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  // The pre-check finds the version on npm and short-circuits to success without
  // ever running changeset:publish.
  const { status, output } = runPublish({
    version: ALREADY_PUBLISHED_VERSION,
    publishScript: 'node -e "process.exit(1)"', // must never run
  });

  expect(output).toContain('published=true');
  expect(output).toContain('already_published=true');
  expect(status).toBe(0);
}, 130000);
