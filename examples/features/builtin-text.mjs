// Text and value built-ins: echo, cat, seq, basename, dirname, true, false, test.
import { $ } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import fs from 'fs';
import path from 'path';

await example({ id: 'builtin-text', title: 'Text and value built-ins' }, async ({ record }) => {
  const dir = makeTempDir('text');
  const file = path.join(dir, 'greeting.txt');
  fs.writeFileSync(file, 'hello from a file\n');
  const $q = $({ mirror: false });

  record('echo', (await $q`echo hello`).stdout);
  record('echo -n', (await $q`echo -n no newline`).stdout);
  record('cat', (await $q`cat ${file}`).stdout);
  record('seq', (await $q`seq 1 4`).stdout);
  record('basename', (await $q`basename /usr/local/lib/file.txt`).stdout);
  record('dirname', (await $q`dirname /usr/local/lib/file.txt`).stdout);
  record('true', (await $q`true`).code);
  record('false', (await $q`false`).code);
  record('test on an existing file', (await $q`test -f ${file}`).code);
  record('test on a missing file', (await $q`test -f ${path.join(dir, 'missing')}`).code);
});
