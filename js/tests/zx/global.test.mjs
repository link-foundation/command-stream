// Port of zx test/global.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { test, describe } from 'node:test';
import '../../src/zx/globals.mjs';
import * as index from '../../src/zx/index.mjs';
import { nativePath } from './fixtures/paths.mjs';
/* global global, $, cd, path */

// Upstream deletes the globals after the suite. Bun runs every test file in
// one process and evaluates `globals.mjs` only once, so that cleanup would
// strip the globals from later files that import the entry (smoke-win32).
// Node runs each file in its own process, where the cleanup changes nothing.
describe('global', () => {
  test('[zx:test/global.test.js:27:3:registration] global cd()', async () => {
    const cwd = (await $`pwd`).toString().trim();
    cd('/');
    assert.equal(
      nativePath((await $`pwd`).toString().trim()),
      nativePath(path.resolve('/'))
    );
    // Git Bash prints `/d/a`, which Node's chdir cannot resolve.
    cd(nativePath(cwd));
    assert.equal(nativePath((await $`pwd`).toString().trim()), nativePath(cwd));
  });

  test('[zx:test/global.test.js:35:3:registration] injects zx index to global', () => {
    for (const [key, value] of Object.entries(index)) {
      assert.equal(global[key], value);
    }
  });
});
