// File system built-ins: mkdir, touch, ls, cp, mv, rm.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example(
  { id: 'builtin-filesystem', title: 'File system built-ins' },
  async ({ record }) => {
    const dir = makeTempDir('fs');
    const $q = $({ mirror: false, cwd: dir });

    await $q`mkdir -p project/src`;
    record(
      'mkdir -p created the tree',
      fs.existsSync(path.join(dir, 'project/src'))
    );

    await $q`touch project/src/index.mjs`;
    record(
      'touch created the file',
      fs.existsSync(path.join(dir, 'project/src/index.mjs'))
    );

    record('ls', (await $q`ls project/src`).stdout);

    await $q`cp project/src/index.mjs project/src/copy.mjs`;
    record('after cp', (await $q`ls project/src`).stdout);

    await $q`mv project/src/copy.mjs project/src/renamed.mjs`;
    record('after mv', (await $q`ls project/src`).stdout);

    await $q`rm project/src/renamed.mjs`;
    record('after rm', (await $q`ls project/src`).stdout);

    await $q`rm -rf project`;
    record(
      'the tree still exists after rm -rf',
      fs.existsSync(path.join(dir, 'project'))
    );
  }
);
