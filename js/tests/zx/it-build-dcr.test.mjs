// Port of zx test/it/build-dcr.test.js (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.
//
// Upstream pipes a script into `docker run -i zx`, whose entrypoint is the zx
// CLI reading the script from stdin. command-stream publishes no container
// image, so the port feeds the same scripts to the same entrypoint - the CLI
// with no script argument - in a child process of the current runtime.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { IT_TIMEOUT, ROOT, runOk } from './fixtures/it/artifact.mjs';

const CLI = path.join(ROOT, 'src/zx/cli.mjs');

describe('docker container', () => {
  test(
    '[zx:test/it/build-dcr.test.js:20:3:registration] works',
    { timeout: IT_TIMEOUT },
    async () => {
      // The CLI writes a stdin script to `zx.mjs` in its cwd; a private cwd
      // keeps it from colliding with other CLI runs (seen on Windows CI).
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-dcr-'));
      const hello = await runOk(process.execPath, [CLI], {
        cwd,
        input: 'await $({verbose: true})`echo hello`',
      });
      assert.equal(hello.stderr, '$ echo hello\nhello\n');

      // Upstream pins the image's Node.js major (v24); the port checks that
      // the script sees a real `node` binary.
      const node = await runOk(process.execPath, [CLI], {
        cwd,
        input: 'console.log((await $`node -v`).valueOf())',
      });
      assert.match(node.stdout, /^v\d+\.\d+\.\d+\n$/);
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  );
});
