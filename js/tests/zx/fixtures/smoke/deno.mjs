// Port of zx test/smoke/deno.test.js (issue #26). Upstream pulls `assert` from
// deno.land/std; Deno's `node:assert` keeps the port offline.
import assert from 'node:assert';
import { $ } from '../../../../src/zx/index.mjs';
import '../../../../src/zx/cli.mjs';

Deno.test('deno smoke test', async () => {
  // smoke test
  {
    const p = await $`echo foo`;
    assert(p.valueOf() === 'foo');
  }

  // captures err stack
  {
    const p = await $({ nothrow: true })`echo foo; exit 3`;
    assert(p.message.match(/exit code: 3/));
  }
});
