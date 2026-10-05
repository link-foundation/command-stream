// Port of zx test/smoke/node.test.cjs (issue #26): the CommonJS globals entry.
const assert = require('assert');
require('command-stream/zx/globals');
/* global $, which */
(async () => {
  // smoke test
  {
    const p = await $`echo foo`;
    assert.match(p.stdout, /foo/);
  }

  // captures err stack
  {
    const p = await $({ nothrow: true })`echo foo; exit 3`;
    assert.match(p.message, /exit code: 3/);
  }

  // which() resolves a known binary
  {
    const async = await which('node');
    const sync = which.sync('node');
    assert.equal(async, sync);
    assert.ok(async && async.length > 0);
    assert.equal(
      which.sync('definitely-not-a-real-bin', { nothrow: true }),
      null
    );
  }

  console.log('smoke cjs: ok');
})();
