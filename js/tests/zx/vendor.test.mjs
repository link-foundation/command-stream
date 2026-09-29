// Port of zx test/vendor.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import {
  YAML,
  MAML,
  minimist,
  which,
  glob,
  nodeFetch as fetch,
} from '../../src/zx/vendor.mjs';

describe('vendor API', () => {
  describe('YAML', () => {
    test('[zx:test/vendor.test.js:28:5:registration] parse()', () => {
      assert.deepEqual(YAML.parse('a: b\n'), { a: 'b' });
    });
    test('[zx:test/vendor.test.js:31:5:registration] stringify()', () => {
      assert.equal(YAML.stringify({ a: 'b' }), 'a: b\n');
    });
  });

  describe('MAML', () => {
    test('[zx:test/vendor.test.js:37:5:registration] parse()/stringify()', () => {
      const maml = `{
  project: "MAML"
  tags: [
    "minimal"
    "readable"
  ]
  spec: {
    version: 1
    author: "Anton Medvedev"
  }
  notes: """
This is a multiline string.
Keeps formatting as‑is.
"""
}`;
      const obj = MAML.parse(maml);

      assert.deepEqual(MAML.parse(MAML.stringify(obj)), obj);
      assert.deepEqual(obj, {
        project: 'MAML',
        tags: ['minimal', 'readable'],
        spec: {
          version: 1,
          author: 'Anton Medvedev',
        },
        notes: 'This is a multiline string.\nKeeps formatting as‑is.\n',
      });
    });
  });

  test('[zx:test/vendor.test.js:68:3:registration] globby() works', async () => {
    // Upstream globs its repo root, which holds a single README.md; the port
    // recreates that layout instead of depending on the runner's cwd.
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'zx-globby-'));
    await fsp.writeFile(path.join(cwd, 'README.md'), '# test\n');
    await fsp.writeFile(path.join(cwd, 'package.json'), '{}\n');
    try {
      assert.deepEqual(await glob('*.md', { cwd }), ['README.md']);
      assert.deepEqual(glob.sync('*.md', { cwd }), ['README.md']);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
  });

  test('[zx:test/vendor.test.js:73:3:registration] fetch() works', async () => {
    assert.match(
      await fetch('https://github.com').then((res) => res.text()),
      /GitHub/
    );
  });

  test('[zx:test/vendor.test.js:80:3:registration] which() available', async () => {
    assert.equal(which.sync('npm'), await which('npm'));
    assert.throws(() => which.sync('not-found-cmd'), /not-found-cmd/);
  });

  test('[zx:test/vendor.test.js:85:3:registration] minimist available', async () => {
    assert.equal(typeof minimist, 'function');
  });

  test('[zx:test/vendor.test.js:89:3:registration] minimist works', async () => {
    assert.deepEqual(
      minimist(
        ['--foo', 'bar', '-a', '5', '-a', '42', '--force', './some.file'],
        { boolean: 'force' }
      ),
      {
        a: [5, 42],
        foo: 'bar',
        force: true,
        _: ['./some.file'],
      }
    );
  });
});
