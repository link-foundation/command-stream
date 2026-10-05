// Node.js suite for the CommonJS entry point (issue #189).
//
// The Bun suite in commonjs-entry.test.mjs covers the resolved shape; this file
// runs under `node --test` so the CI Node.js matrix (20, 22, 24) proves that a
// real CommonJS host can require('command-stream') and call the synchronous
// ProcessRunner.sync() API without any await.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createCommonJsSandbox,
  removeCommonJsSandbox,
  runSandboxScript,
  supportsRequireEsm,
} from './commonjs-sandbox.mjs';

test('require("command-stream") exposes the synchronous API', (context) => {
  if (!supportsRequireEsm(process.versions.node)) {
    context.skip(`node ${process.versions.node} has no require(esm) support`);
    return;
  }

  const sandbox = createCommonJsSandbox();
  context.after(() => removeCommonJsSandbox(sandbox));

  const result = runSandboxScript(sandbox, 'launch-probe.cjs', [
    "const $ = require('command-stream');",
    'const probe = $({ mirror: false })`echo node-cjs-probe`.sync();',
    'process.stdout.write(`${typeof $}:${probe.code}:${probe.stdout.trim()}`);',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'function:0:node-cjs-probe');
});

test('require("command-stream") exposes cross-spawn sync semantics', (context) => {
  if (!supportsRequireEsm(process.versions.node)) {
    context.skip(`node ${process.versions.node} has no require(esm) support`);
    return;
  }

  const sandbox = createCommonJsSandbox();
  context.after(() => removeCommonJsSandbox(sandbox));

  const result = runSandboxScript(sandbox, 'spawn-probe.cjs', [
    "const $ = require('command-stream');",
    "const result = $.spawn.sync(process.execPath, ['-e', 'process.exit(9)']);",
    'process.stdout.write(`${typeof $.spawn}:${result.status}:${Boolean(result.error)}`);',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'function:9:false');
});
