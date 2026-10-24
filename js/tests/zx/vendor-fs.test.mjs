import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fse, * as named from '../../src/zx/vendor/fs.mjs';

const EXTRAS = [
  'copy',
  'copySync',
  'move',
  'moveSync',
  'remove',
  'removeSync',
  'emptyDir',
  'emptyDirSync',
  'emptydir',
  'emptydirSync',
  'ensureDir',
  'ensureDirSync',
  'mkdirs',
  'mkdirsSync',
  'mkdirp',
  'mkdirpSync',
  'ensureFile',
  'ensureFileSync',
  'createFile',
  'createFileSync',
  'ensureLink',
  'ensureLinkSync',
  'createLink',
  'createLinkSync',
  'ensureSymlink',
  'ensureSymlinkSync',
  'createSymlink',
  'createSymlinkSync',
  'outputFile',
  'outputFileSync',
  'outputJson',
  'outputJsonSync',
  'outputJSON',
  'outputJSONSync',
  'readJson',
  'readJsonSync',
  'readJSON',
  'readJSONSync',
  'writeJson',
  'writeJsonSync',
  'writeJSON',
  'writeJSONSync',
  'pathExists',
  'pathExistsSync',
  'gracefulify',
];

describe('vendor/fs', () => {
  let dir;
  const p = (...parts) => path.join(dir, ...parts);

  before(() => {
    dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  });

  after(() => {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  });

  test('exposes node:fs and fs-extra functions', () => {
    for (const name of EXTRAS) {
      assert.equal(typeof fse[name], 'function', name);
      assert.equal(typeof named[name], 'function', name);
    }
    for (const name of [
      'readFile',
      'readFileSync',
      'stat',
      'createReadStream',
    ]) {
      assert.equal(typeof fse[name], 'function', name);
    }
    assert.equal(typeof fse.promises.readFile, 'function');
    assert.equal(typeof fse.constants, 'object');
  });

  test('universalifies callback APIs', async () => {
    nodeFs.writeFileSync(p('u.txt'), 'hello');
    assert.equal(await fse.readFile(p('u.txt'), 'utf8'), 'hello');
    const viaCb = await new Promise((resolve, reject) => {
      fse.readFile(p('u.txt'), 'utf8', (err, data) =>
        err ? reject(err) : resolve(data)
      );
    });
    assert.equal(viaCb, 'hello');
    assert.equal(await fse.exists(p('u.txt')), true);
    assert.equal(await fse.exists(p('missing')), false);
  });

  test('ensure*, output* and pathExists', async () => {
    await fse.ensureDir(p('a', 'b', 'c'));
    assert.ok(nodeFs.statSync(p('a', 'b', 'c')).isDirectory());
    fse.ensureFileSync(p('x', 'y', 'file.txt'));
    assert.equal(nodeFs.readFileSync(p('x', 'y', 'file.txt'), 'utf8'), '');
    await fse.outputFile(p('out', 'deep', 'o.txt'), 'data');
    assert.equal(
      nodeFs.readFileSync(p('out', 'deep', 'o.txt'), 'utf8'),
      'data'
    );
    fse.outputFileSync(p('out2', 'o.txt'), 'sync');
    assert.equal(nodeFs.readFileSync(p('out2', 'o.txt'), 'utf8'), 'sync');
    assert.equal(await fse.pathExists(p('out2', 'o.txt')), true);
    assert.equal(await fse.pathExists(p('nope')), false);
    assert.equal(fse.pathExistsSync(p('out2')), true);
  });

  test('JSON helpers', async () => {
    const obj = { a: 1, b: [true, null] };
    await fse.outputJson(p('json', 'a.json'), obj, { spaces: 2 });
    const text = nodeFs.readFileSync(p('json', 'a.json'), 'utf8');
    assert.equal(text, `${JSON.stringify(obj, null, 2)}\n`);
    assert.deepEqual(await fse.readJson(p('json', 'a.json')), obj);
    fse.writeJsonSync(p('json', 'b.json'), obj);
    assert.deepEqual(fse.readJSONSync(p('json', 'b.json')), obj);
    nodeFs.writeFileSync(p('json', 'bad.json'), '{oops');
    assert.throws(() => fse.readJsonSync(p('json', 'bad.json')), /bad\.json/);
    await assert.rejects(fse.readJson(p('json', 'bad.json')));
    assert.equal(
      fse.readJsonSync(p('json', 'bad.json'), { throws: false }),
      null
    );
    nodeFs.writeFileSync(p('json', 'bom.json'), '﻿{"x":1}');
    assert.deepEqual(fse.readJsonSync(p('json', 'bom.json')), { x: 1 });
  });

  test('copy, move, remove and emptyDir', async () => {
    fse.outputFileSync(p('src', 'one.txt'), '1');
    fse.outputFileSync(p('src', 'sub', 'two.txt'), '2');
    await fse.copy(p('src'), p('dst'));
    assert.equal(nodeFs.readFileSync(p('dst', 'sub', 'two.txt'), 'utf8'), '2');
    fse.copySync(p('src'), p('dst-filtered'), {
      filter: (src) => !src.endsWith('one.txt'),
    });
    assert.equal(nodeFs.existsSync(p('dst-filtered', 'one.txt')), false);
    assert.equal(nodeFs.existsSync(p('dst-filtered', 'sub', 'two.txt')), true);
    await assert.rejects(
      fse.copy(p('src'), p('src', 'sub', 'inner')),
      /itself/
    );

    await fse.move(p('dst'), p('moved'));
    assert.equal(nodeFs.existsSync(p('dst')), false);
    assert.equal(nodeFs.readFileSync(p('moved', 'one.txt'), 'utf8'), '1');
    await assert.rejects(fse.move(p('src'), p('moved')), /dest already exists/);
    fse.moveSync(p('src'), p('moved'), { overwrite: true });
    assert.equal(nodeFs.existsSync(p('src')), false);

    await fse.emptyDir(p('moved'));
    assert.deepEqual(nodeFs.readdirSync(p('moved')), []);
    await fse.remove(p('moved'));
    fse.removeSync(p('dst-filtered'));
    await fse.remove(p('does-not-exist'));
    assert.equal(nodeFs.existsSync(p('moved')), false);
    assert.equal(nodeFs.existsSync(p('dst-filtered')), false);
  });

  test('ensureLink and ensureSymlink', async (t) => {
    fse.outputFileSync(p('link-src.txt'), 'L');
    await fse.ensureLink(p('link-src.txt'), p('links', 'hard.txt'));
    assert.equal(nodeFs.readFileSync(p('links', 'hard.txt'), 'utf8'), 'L');
    try {
      await fse.ensureSymlink(p('link-src.txt'), p('links', 'soft.txt'));
    } catch (err) {
      if (err.code === 'EPERM') {
        t.skip('symlinks are not permitted');
        return;
      }
      throw err;
    }
    assert.ok(nodeFs.lstatSync(p('links', 'soft.txt')).isSymbolicLink());
    // idempotent
    fse.ensureSymlinkSync(p('link-src.txt'), p('links', 'soft.txt'));
  });
});
