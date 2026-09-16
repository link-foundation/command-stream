// README documents `seq 1 5 | cat > numbers.txt`. Does it actually redirect?
import { $ } from '../src/$.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pipe-redirect-${runtime}-`));
const $q = $({ mirror: false, capture: true });

async function probe(label, run, file) {
  const r = await run();
  console.log(`[${runtime}] ${label.padEnd(30)} code=${r.code} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr.trim())} file=${fs.existsSync(file) ? JSON.stringify(fs.readFileSync(file, 'utf8')) : 'MISSING'}`);
}

const f1 = path.join(dir, 'a.txt');
await probe('seq 1 3 | cat > f', () => $q`seq 1 3 | cat > ${f1}`, f1);
const f2 = path.join(dir, 'b.txt');
await probe('sh -c seq | cat > f', () => $q`sh -c 'seq 1 3' | cat > ${f2}`, f2);
const f3 = path.join(dir, 'c.txt');
fs.writeFileSync(f3, 'from-file\n');
const r = await $q`cat < ${f3}`;
console.log(`[${runtime}] ${'cat < f'.padEnd(30)} code=${r.code} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr.trim())}`);

fs.rmSync(dir, { recursive: true, force: true });
