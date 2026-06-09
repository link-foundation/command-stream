// Regression tests for js/scripts/check-release-needed.mjs
//
// Issue #166 (follow-up): after the false-positive fix, a CI restart "failed to
// do any deploy". Root cause: the repo version (e.g. 0.10.2) was bumped and
// committed to main but never published to npm (npm latest was 0.9.5). With no
// changeset left to trigger a publish, the release job's publish step was
// gated off and the unpublished version was stranded forever.
//
// check-release-needed.mjs adds the self-healing path: with no changesets, it
// probes npm and, when the current version is not published, emits
// should_release=true + skip_bump=true so the workflow runs a catch-up publish.

import { test, expect, beforeAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../scripts/check-release-needed.mjs');

// A version that definitely does not exist on npm → self-healing should fire.
const UNPUBLISHED_VERSION = '99.99.99-issue166-test';
// A real, long-published version → no release needed.
const ALREADY_PUBLISHED_VERSION = '0.9.5';

// Subprocess + network integration test (downloads use-m, loads command-stream,
// hits the npm registry). Windows runners are slow/flaky for this; cover on
// Linux and macOS and skip Windows, mirroring publish-to-npm.test.mjs.
const isWindows = process.platform === 'win32';
let networkAvailable = !isWindows;

beforeAll(() => {
  if (isWindows) {
    return;
  }
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
 * Run check-release-needed.mjs in an isolated temp package.
 * @param {object} opts
 * @param {string} opts.version - version written to the temp package.json
 * @param {string} opts.hasChangesets - value of the HAS_CHANGESETS env var
 * @returns {{status:number, stdout:string, stderr:string, output:string}}
 */
function runCheck({ version, hasChangesets }) {
  const dir = mkdtempSync(join(tmpdir(), 'issue166-release-needed-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'command-stream', version }, null, 2)
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
      HAS_CHANGESETS: hasChangesets,
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

test('self-heals: no changesets + version not on npm → should_release=true, skip_bump=true', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  const { status, output } = runCheck({
    version: UNPUBLISHED_VERSION,
    hasChangesets: 'false',
  });

  expect(output).toContain('should_release=true');
  expect(output).toContain('skip_bump=true');
  expect(status).toBe(0);
}, 130000);

test('no release: no changesets + version already on npm → should_release=false', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  const { status, output } = runCheck({
    version: ALREADY_PUBLISHED_VERSION,
    hasChangesets: 'false',
  });

  expect(output).toContain('should_release=false');
  expect(output).toContain('skip_bump=false');
  expect(status).toBe(0);
}, 130000);

test('changesets present → should_release=true, skip_bump=false (no npm probe needed)', () => {
  if (!networkAvailable) {
    return;
  } // offline: skip
  // Even with a version that is already published, an explicit changeset means
  // a new version will be produced, so a release is needed and the bump runs.
  const { status, output } = runCheck({
    version: ALREADY_PUBLISHED_VERSION,
    hasChangesets: 'true',
  });

  expect(output).toContain('should_release=true');
  expect(output).toContain('skip_bump=false');
  expect(status).toBe(0);
}, 130000);
