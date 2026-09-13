// Shared helper for the CommonJS entry point tests (issue #189).
//
// Both the Bun suite (tests/commonjs-entry.test.mjs) and the Node.js suite
// (tests/node-commonjs-entry.mjs) need a throwaway package that resolves
// `command-stream` as a bare specifier, so the package.json "exports"
// conditions are exercised exactly the way a consumer would hit them.

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..'
);

/**
 * Whether a Node.js version can `require()` an ES module.
 *
 * require(esm) shipped unflagged in Node.js 20.19.0 and 22.12.0; older lines
 * throw ERR_REQUIRE_ESM, which $.cjs converts into an actionable message.
 *
 * @param {string} version Node.js version string, with or without a leading v.
 * @returns {boolean} True when require(esm) is supported.
 */
export function supportsRequireEsm(version) {
  const [major, minor] = String(version)
    .replace(/^v/, '')
    .split('.')
    .map(Number);
  if (major > 22) {
    return true;
  }
  if (major === 22) {
    return minor >= 12;
  }
  if (major === 20) {
    return minor >= 19;
  }
  return false;
}

/**
 * Resolve the version of the `node` executable on PATH.
 *
 * @returns {string | null} The version string, or null when node is missing.
 */
export function detectNodeVersion() {
  try {
    const probe = spawnSync('node', ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return probe.status === 0 ? probe.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Create a temporary package whose node_modules links back to this package.
 *
 * @returns {string} Absolute path of the sandbox directory.
 */
export function createCommonJsSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'command-stream-cjs-'));
  mkdirSync(join(sandbox, 'node_modules'));
  // 'junction' keeps Windows runners working without developer mode.
  symlinkSync(
    PACKAGE_ROOT,
    join(sandbox, 'node_modules', 'command-stream'),
    'junction'
  );
  return sandbox;
}

/**
 * Remove a sandbox created by createCommonJsSandbox().
 *
 * @param {string | null} sandbox Sandbox directory to delete.
 */
export function removeCommonJsSandbox(sandbox) {
  if (sandbox) {
    rmSync(sandbox, { force: true, recursive: true });
  }
}

/**
 * Write a CommonJS script into the sandbox and execute it with Node.js.
 *
 * @param {string} sandbox Sandbox directory.
 * @param {string} name File name to write, e.g. 'probe.cjs'.
 * @param {string[]} lines Source lines of the script.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Result.
 */
export function runSandboxScript(sandbox, name, lines) {
  const scriptPath = join(sandbox, name);
  writeFileSync(scriptPath, `${lines.join('\n')}\n`);
  return spawnSync('node', [scriptPath], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: 30000,
  });
}
