import assert from 'node:assert';
import { describe, test, before, after } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import which, { sync } from '../../src/zx/vendor/which.mjs';

const IS_WIN = process.platform === 'win32';
const norm = (p) => (IS_WIN ? path.resolve(p).toLowerCase() : path.resolve(p));

describe('vendor/which', () => {
  const exe = path.basename(process.execPath);
  const exeDir = path.dirname(process.execPath);
  let dir1;
  let dir2;

  const makeTool = (dir) => {
    const file = path.join(dir, IS_WIN ? 'cs-tool.cmd' : 'cs-tool');
    fs.writeFileSync(file, IS_WIN ? '@echo off\r\n' : '#!/bin/sh\n');
    fs.chmodSync(file, 0o755);
    return file;
  };

  before(() => {
    dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
    dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  });

  after(() => {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  test('exposes which, which.sync and a named sync', () => {
    assert.equal(typeof which, 'function');
    assert.equal(typeof which.sync, 'function');
    assert.equal(which.sync, sync);
  });

  test('finds the running executable (async and sync agree)', async () => {
    const opts = { path: exeDir };
    const found = await which(exe, opts);
    assert.equal(norm(found), norm(process.execPath));
    assert.equal(which.sync(exe, opts), found);
  });

  test('finds executables from PATH', async () => {
    const tool = makeTool(dir1);
    const prev = process.env.PATH;
    process.env.PATH = [dir1, prev].join(path.delimiter);
    try {
      assert.equal(norm(await which('cs-tool')), norm(tool));
      assert.equal(norm(which.sync('cs-tool')), norm(tool));
    } finally {
      process.env.PATH = prev;
    }
  });

  test('returns every match with { all: true }', async () => {
    makeTool(dir2);
    const opts = { path: [dir1, dir2].join(path.delimiter), all: true };
    const all = await which('cs-tool', opts);
    assert.equal(all.length, 2);
    assert.deepEqual(which.sync('cs-tool', opts), all);
    assert.equal(norm(path.dirname(all[0])), norm(dir1));
    assert.equal(norm(path.dirname(all[1])), norm(dir2));
  });

  test('accepts paths containing a slash', async () => {
    const tool = makeTool(dir1);
    assert.equal(norm(await which(tool)), norm(tool));
  });

  test('throws or returns null when not found', async () => {
    const cmd = 'not-found-cmd-cs-xyz';
    assert.throws(() => which.sync(cmd), /not-found-cmd-cs-xyz/);
    await assert.rejects(which(cmd), (err) => {
      assert.match(err.message, /not found: not-found-cmd-cs-xyz/);
      assert.equal(err.code, 'ENOENT');
      return true;
    });
    assert.equal(which.sync(cmd, { nothrow: true }), null);
    assert.equal(await which(cmd, { nothrow: true }), null);
  });

  test('skips non-executable files on POSIX', { skip: IS_WIN }, () => {
    const file = path.join(dir2, 'cs-plain');
    fs.writeFileSync(file, 'data');
    fs.chmodSync(file, 0o644);
    assert.equal(which.sync('cs-plain', { path: dir2, nothrow: true }), null);
  });
});
