// Port of zx test/smoke/deno.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// The Deno.test body lives in tests/zx/fixtures/smoke/deno.mjs and runs under
// `deno test` whenever Deno is on PATH (CI installs it for the Node jobs).

import assert from 'node:assert';
import { test, describe } from 'node:test';
import { which } from '../../src/zx/index.mjs';
import { runFixture, smokeFixture } from './fixtures/smoke/run.mjs';

const deno = which.sync('deno', { nothrow: true });

describe('smoke: deno', () => {
  test(
    '[zx:test/smoke/deno.test.js:19:1:registration] deno smoke test',
    { skip: deno ? false : 'deno is not installed' },
    async () => {
      const { code, stdout, stderr } = await runFixture(
        smokeFixture('deno.mjs'),
        { bin: deno, args: ['test', '--allow-all', '--no-check', '--no-lock'] }
      );
      assert.equal(code, 0, `${stdout}\n${stderr}`);
      const report = `${stdout}${stderr}`.replace(/\u001B\[[\d;]*m/g, '');
      assert.match(report, /deno smoke test \.\.\. ok/);
    }
  );
});
