// Port of zx test/smoke/bun.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// Upstream imports `bun:test`; the port uses `node:test`, which Bun maps onto
// its own runner, so the same cases also run under Node.

import assert from 'node:assert';
import { test, describe } from 'node:test';
import { $, within, tmpdir } from '../../src/zx/index.mjs';
import '../../src/zx/cli.mjs';

describe('bun', () => {
  test('[zx:test/smoke/bun.test.js:21:3:registration] smoke test', async () => {
    const p = await $`echo foo`;
    assert.match(p.stdout, /foo/);
  });

  test('[zx:test/smoke/bun.test.js:26:3:registration] captures err stack', async () => {
    const p = await $({ nothrow: true })`echo foo; exit 3`;
    assert.match(p.message, /exit code: 3/);
  });

  test('[zx:test/smoke/bun.test.js:31:3:registration] stdio: inherit', async () => {
    await $({ stdio: 'inherit' })`ls`;
  });

  test('[zx:test/smoke/bun.test.js:35:3:registration] ctx isolation', async () => {
    await within(async () => {
      const t1 = tmpdir();
      const t3 = tmpdir();
      $.cwd = t1;
      assert.equal($.cwd, t1);
      assert.equal($.cwd, t1);

      const w = within(async () => {
        const t3 = tmpdir();
        $.cwd = t3;
        assert.equal($.cwd, t3);

        assert.ok((await $`pwd`).toString().trim().endsWith(t3));
        assert.equal($.cwd, t3);
      });

      await $`pwd`;
      assert.ok((await $`pwd`).toString().trim().endsWith(t1));
      assert.equal($.cwd, t1);
      assert.ok((await $`pwd`).toString().trim().endsWith(t1));

      $.cwd = t3;
      assert.ok((await $`pwd`).toString().trim().endsWith(t3));
      assert.equal($.cwd, t3);

      await w;
    });
  });
});
