// Finite reproduction of reload identity through a symlinked workspace.
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import $, { install, dev } from '../../js/src/$.mjs';

const dir = await mkdtemp(join(tmpdir(), 'command-watch-symlink-'));
let controller;
let installed;
let watchdog;
try {
  const actual = join(dir, 'actual');
  const linked = join(dir, 'linked');
  await mkdir(actual);
  await symlink(
    actual,
    linked,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const file = join(linked, 'commands.mjs');
  await writeFile(
    file,
    "export default {commands:{'symlink-watch-fixture':()=>({code:0,stdout:'before'})}}"
  );
  installed = await install(file);
  let restart;
  const changed = new Promise((resolve, reject) => {
    restart = resolve;
    watchdog = setTimeout(
      () => reject(new Error('Reload was not observed')),
      2000
    );
  });
  controller = dev({
    cwd: linked,
    entry: null,
    packages: [installed],
    watch: ['**/*.mjs'],
    interval: 10,
    debounce: 0,
    onRestart: restart,
  });
  await controller.ready;
  await writeFile(
    join(linked, 'next.tmp'),
    "export default {commands:{'symlink-watch-fixture':()=>({code:0,stdout:'after'})}}"
  );
  await rename(join(linked, 'next.tmp'), file);
  const files = await changed;
  assert.ok(
    files.includes(installed.file),
    'Watch and package identities differ'
  );
  assert.equal(
    await (await $({ mirror: false })`symlink-watch-fixture`).text(),
    'after'
  );
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? 'bun' : 'node',
      reloaded: true,
    })
  );
} finally {
  clearTimeout(watchdog);
  await controller?.close();
  installed?.uninstall();
  await rm(dir, { recursive: true, force: true });
}
