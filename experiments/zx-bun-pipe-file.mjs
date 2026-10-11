// Repro: `await $\`echo foo\`.pipe(file)` resolving before the data hits the
// file (seen on Bun). Run with `bun` or `node`.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $ } from '../js/src/zx/core.mjs';

let bad = 0;
for (let i = 0; i < 50; i++) {
  const file = path.join(os.tmpdir(), `cs-zx-pipe-${process.pid}-${i}`);
  await $`echo foo`.pipe(file);
  if ((await fs.readFile(file, 'utf8')) !== 'foo\n') {
    bad++;
  }
  await fs.rm(file, { force: true });
}
console.log(`${process.versions.bun ? 'bun' : 'node'}: ${bad}/50 early`);
