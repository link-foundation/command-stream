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

// ---------------------------------------------------------------------------
// Issue #199 — a slow registry after a successful publish must not fail the
// release.
//
// The three tests above run against the real npm registry, which cannot be made
// to lag on demand. These run the same real script against a stub registry
// served over HTTP (PUBLISH_REGISTRY_URL redirects the publication check only),
// so the exact production sequence from run 33914574283 is reproducible:
//
//   pre-check      -> 404 (version not published yet)
//   publish        -> npm E409 "Cannot publish over previously staged version"
//   verification   -> 404 on the first poll, then the version appears
//
// Before the fix this ended in "❌ Failed to publish after 3 attempts" while
// the version was live on npm.

/**
 * Serve npm package metadata that reveals `version` only from the Nth read on.
 * @param {object} options
 * @param {string} options.packageName
 * @param {string} options.version
 * @param {number} options.visibleFromRead - 1-based read index
 * @returns {Promise<{url: string, reads: () => number, stop: () => void}>}
 */
async function startLaggingRegistry({ packageName, version, visibleFromRead }) {
  let reads = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const wanted = `/${encodeURIComponent(packageName)}`;
      if (new URL(request.url).pathname !== wanted) {
        return new Response('not found', { status: 404 });
      }
      reads++;
      if (reads < visibleFromRead) {
        return new Response('{}', { status: 404 });
      }
      return Response.json({ name: packageName, versions: { [version]: {} } });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    reads: () => reads,
    stop: () => server.stop(true),
  };
}

/**
 * Run publish-to-npm.mjs against a stub registry.
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.publishScript
 * @param {string} opts.registryUrl
 * @returns {Promise<{status:number, stdout:string, stderr:string, output:string}>}
 */
async function runPublishAgainstRegistry({
  version,
  publishScript,
  registryUrl,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'issue199-publish-'));
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

  // Must be asynchronous: the stub registry runs in this process, so a
  // synchronous spawn would block the event loop and never answer a request.
  const child = Bun.spawn(['bun', SCRIPT], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      // Only the publication check is redirected. Overriding NPM_CONFIG_REGISTRY
      // would also redirect use-m's module installation, which must keep
      // talking to the real registry.
      PUBLISH_REGISTRY_URL: registryUrl,
      PUBLISH_RETRY_DELAY: '0',
      PUBLISH_VERIFY_DELAY: '0',
      PUBLISH_VERIFY_MAX_DELAY: '0',
    },
  });

  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return {
    status,
    stdout,
    stderr,
    output: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '',
  };
}

// The verbatim npm output from the failed run, escaped for `node -e`.
const E409_STAGED_OUTPUT =
  'npm error code E409\\nnpm error 409 Conflict - PUT https://registry.npmjs.org/command-stream - Cannot publish over previously staged version "0.20.1"';

test('issue #199: an E409 "previously staged version" resolves to a successful release', async () => {
  if (!networkAvailable) {
    return;
  } // offline: skip (the script still fetches use-m from unpkg)

  const registry = await startLaggingRegistry({
    packageName: 'command-stream',
    version: '0.20.1',
    // read 1 = the pre-check (404), read 2 = first verification poll (404),
    // read 3 = the version becomes visible.
    visibleFromRead: 3,
  });

  try {
    const { status, output, stdout } = await runPublishAgainstRegistry({
      version: '0.20.1',
      publishScript: `node -e "console.error('${E409_STAGED_OUTPUT}'); process.exit(1)"`,
      registryUrl: registry.url,
    });

    expect(output).toContain('published=true');
    expect(output).toContain('published_version=0.20.1');
    expect(output).not.toContain('published=false');
    expect(status).toBe(0);
    // The publish command must not be re-run: republishing is what produced the
    // E409 in the first place.
    expect(stdout).toContain('Publish attempt 1 of 3');
    expect(stdout).not.toContain('Publish attempt 2 of 3');
  } finally {
    registry.stop();
  }
}, 130000);

test('issue #199: registry propagation lag after a clean publish is not a failure', async () => {
  if (!networkAvailable) {
    return;
  } // offline: skip

  const registry = await startLaggingRegistry({
    packageName: 'command-stream',
    version: '0.20.1',
    visibleFromRead: 4,
  });

  try {
    const { status, output, stdout } = await runPublishAgainstRegistry({
      version: '0.20.1',
      publishScript:
        'node -e "console.log(\'🦋  success packages published successfully\'); process.exit(0)"',
      registryUrl: registry.url,
    });

    expect(output).toContain('published=true');
    expect(status).toBe(0);
    expect(stdout).not.toContain('Publish attempt 2 of 3');
    // Polling, not a single sample, is what makes this pass.
    expect(registry.reads()).toBeGreaterThan(2);
  } finally {
    registry.stop();
  }
}, 130000);

test('issue #166 stays fixed: verification exhaustion still fails the release', async () => {
  if (!networkAvailable) {
    return;
  } // offline: skip

  const registry = await startLaggingRegistry({
    packageName: 'command-stream',
    version: '0.20.1',
    visibleFromRead: Number.MAX_SAFE_INTEGER, // never becomes visible
  });

  try {
    const { status, output } = await runPublishAgainstRegistry({
      version: '0.20.1',
      publishScript:
        'node -e "console.log(\'no projects to publish\'); process.exit(0)"',
      registryUrl: registry.url,
    });

    expect(output).toContain('published=false');
    expect(output).not.toContain('published=true');
    expect(status).not.toBe(0);
  } finally {
    registry.stop();
  }
}, 130000);
