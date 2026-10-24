// Port of zx test/smoke/ts.test.ts (issue #26): typed use of the globals.
import * as assert from 'node:assert';
import 'command-stream/zx/globals';
(async () => {
  // smoke test async
  {
    const p = await $`echo foo`;
    assert.match(p.stdout, /foo/);
  }

  // smoke test sync
  {
    const p = $.sync`echo foo`;
    assert.match(p.stdout, /foo/);
  }

  // captures err stack
  {
    const p = await $({ nothrow: true })`echo foo; exit 3`;
    assert.match(p.message, /exit code: 3/);
  }
})();

console.log('smoke ts: ok');
