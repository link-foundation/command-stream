// Port of zx test/smoke/node.test.cjs and test/smoke/node.test.mjs (issue #26).
// Test vectors come from google/zx (Apache-2.0) at the pinned corpus commit.
//
// Upstream runs both files directly with `node`; the port keeps them as
// standalone scripts (tests/zx/fixtures/smoke/) importing the published
// `command-stream/zx/globals` entry, and runs each in a child process of the
// current runtime so Bun covers them too.

import assert from 'node:assert';
import { test, describe } from 'node:test';
import { runFixture, smokeFixture } from './fixtures/smoke/run.mjs';

describe('smoke: node', () => {
  test('[zx:test/smoke/node.test.cjs:1:1:file] CommonJS globals entry', async () => {
    const { code, stdout, stderr } = await runFixture(smokeFixture('node.cjs'));
    assert.equal(code, 0, stderr);
    assert.match(stdout, /smoke cjs: ok/);
  });

  test('[zx:test/smoke/node.test.mjs:1:1:file] ESM globals entry', async () => {
    const { code, stdout, stderr } = await runFixture(smokeFixture('node.mjs'));
    assert.equal(code, 0, stderr);
    assert.match(stdout, /smoke mjs: ok/);
  });
});
