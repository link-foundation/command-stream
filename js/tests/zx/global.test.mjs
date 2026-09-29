// Port of zx test/global.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { test, describe, after } from 'node:test';
import '../../src/zx/globals.mjs';
import * as index from '../../src/zx/index.mjs';
/* global global, $, cd, path */

describe('global', () => {
  after(() => {
    for (const key of Object.keys(index)) {
      delete global[key];
    }
  });

  test('[zx:test/global.test.js:27:3:registration] global cd()', async () => {
    const cwd = (await $`pwd`).toString().trim();
    cd('/');
    assert.equal((await $`pwd`).toString().trim(), path.resolve('/'));
    cd(cwd);
    assert.equal((await $`pwd`).toString().trim(), cwd);
  });

  test('[zx:test/global.test.js:35:3:registration] injects zx index to global', () => {
    for (const [key, value] of Object.entries(index)) {
      assert.equal(global[key], value);
    }
  });
});
