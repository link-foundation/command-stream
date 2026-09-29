// Port of zx test/smoke/node.test.mjs (issue #26): the ESM globals entry.
import assert from 'assert';
import 'command-stream/zx/globals';
import { fakeServer } from '../server.mjs';
import { isPwd } from '../paths.mjs';
/* global $, within, tmpdir, ps, which */
(async () => {
  // smoke test
  {
    const p = await $`echo foo`;
    assert.match(p.stdout, /foo/);
    assert.deepEqual(p.lines(), ['foo']);
  }

  // captures err stack
  {
    const p = await $({ nothrow: true })`echo foo; exit 3`;
    assert.match(p.message, /exit code: 3/);
  }

  // ctx isolation
  {
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

        assert.ok(isPwd((await $`pwd`).toString(), t3));
        assert.equal($.cwd, t3);
      });

      await $`pwd`;
      assert.ok(isPwd((await $`pwd`).toString(), t1));
      assert.equal($.cwd, t1);
      assert.ok(isPwd((await $`pwd`).toString(), t1));

      $.cwd = t3;
      assert.ok(isPwd((await $`pwd`).toString(), t3));
      assert.equal($.cwd, t3);

      await w;
    });
  }

  // ps works fine
  {
    const [root] = await ps.lookup({ pid: process.pid });
    assert.equal(root.pid, process.pid);
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

  // abort controller
  {
    const ac = new AbortController();
    const { signal } = ac;
    const p = $({
      signal,
      timeout: '5s',
      nothrow: true,
      killSignal: 'SIGKILL',
    })`sleep 10`;

    setTimeout(async () => {
      assert.throws(
        () => p.abort('SIGINT'),
        /signal is controlled by another process/
      );
      setTimeout(() => {
        ac.abort('stop');
      }, 500);
    }, 500);

    const o = await p;
    assert.equal(o.signal, 'SIGTERM');
    assert.throws(() => p.kill(), /Too late to kill the process/);
  }

  // fetch() - upstream binds port 8081; the port lets the OS pick one.
  {
    const server = fakeServer([
      `HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 13
Server: netcat!

{"foo":"bar"}
`,
    ]);

    const { url } = await server.start(0);
    const res = await fetch(url);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.foo, 'bar');

    await server.stop();
  }

  console.log('smoke mjs: ok');
})();
