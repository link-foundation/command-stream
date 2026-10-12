// Reproduces the `ls` built-in returning entries in directory order instead of
// sorted order. Real `ls` sorts by name, and readdir order differs between
// Node.js and Bun, so the same script prints different output per runtime.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { $ } from '../js/src/$.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-order-'));
for (const name of ['zebra.txt', 'alpha.txt', 'middle.txt']) {
  fs.writeFileSync(path.join(dir, name), '');
}
console.log('readdir order:', JSON.stringify(fs.readdirSync(dir)));
console.log(
  'ls built-in  :',
  JSON.stringify((await $({ mirror: false })`ls ${dir}`).stdout)
);
fs.rmSync(dir, { recursive: true, force: true });
