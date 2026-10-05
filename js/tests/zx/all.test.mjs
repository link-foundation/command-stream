// Port of zx test/all.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.
//
// Upstream's aggregate entry imports every suite so one runner process covers
// them all. Both of our runners already discover `tests/zx/*.test.mjs`, so
// re-importing would register every test twice; the port instead asserts that
// the aggregate is complete: each suite upstream lists has a ported file that
// carries the port header.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The import list of upstream test/all.test.js.
const UPSTREAM_SUITES = [
  'cli.test.js',
  'core.test.js',
  'deps.test.js',
  'error.test.ts',
  'export.test.js',
  'global.test.js',
  'goods.test.ts',
  'index.test.js',
  'log.test.ts',
  'md.test.ts',
  'util.test.js',
  'vendor.test.js',
];

describe('all', () => {
  test('[zx:test/all.test.js:1:1:file] every upstream suite is ported', () => {
    for (const suite of UPSTREAM_SUITES) {
      const ported = suite.replace(/\.test\.(js|ts)$/, '.test.mjs');
      const file = path.join(__dirname, ported);
      assert.ok(fs.existsSync(file), `missing port of test/${suite}`);
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(
        source.startsWith(`// Port of zx test/${suite} (issue #26).`),
        `${ported} lacks the port header for test/${suite}`
      );
      assert.match(source, new RegExp(`\\[zx:test/${suite}:`));
    }
  });
});
