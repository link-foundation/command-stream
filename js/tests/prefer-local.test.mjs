import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { $, run } from '../src/$.mjs';
import { $ as bun$ } from '../src/bun.mjs';
import { preferLocalBin as zxPreferLocalBin } from '../src/zx/util.mjs';
import { preferLocalBin } from '../src/$.local-bin.mjs';

test('the default API resolves project-local commands through the shared zx resolver', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'command-stream-local-'));
  try {
    const bin = path.join(dir, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    const name = 'command-stream-local-only';
    const executable = path.join(
      bin,
      process.platform === 'win32' ? `${name}.cmd` : name
    );
    await writeFile(
      executable,
      process.platform === 'win32'
        ? '@echo off\r\necho local-command-found\r\n'
        : '#!/bin/sh\nprintf "local-command-found\\n"\n'
    );
    if (process.platform !== 'win32') {
      await chmod(executable, 0o755);
    }

    assert.equal(zxPreferLocalBin, preferLocalBin);
    const options = {
      cwd: dir,
      preferLocal: true,
      mirror: false,
      env: { ...process.env },
    };
    assert.equal(
      (await run(name, options)).stdout.toString().trim(),
      'local-command-found'
    );
    assert.equal(
      $(options)`command-stream-local-only`.sync().stdout.toString().trim(),
      'local-command-found'
    );
    assert.equal(
      (await run(name, { preferLocal: [dir], mirror: false })).stdout
        .toString()
        .trim(),
      'local-command-found'
    );
    const bunLocal = new bun$.Shell().cwd(dir).preferLocal();
    assert.equal(
      (await bunLocal`command-stream-local-only`.text()).trim(),
      'local-command-found'
    );
    assert.equal(
      (
        await new bun$.Shell().cwd(dir)`command-stream-local-only`
          .preferLocal()
          .text()
      ).trim(),
      'local-command-found'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
