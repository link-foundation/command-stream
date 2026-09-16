// Root-cause probe for output redirection with built-in/virtual commands.
// Hypothesis: redirection is only honoured when the *enhanced* shell parser runs,
// which happens only when the command contains &&, ||, ; or ( ... ).
// Without one of those, _parseCommand() treats ">" as a literal argument.
import { $ } from '../src/$.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `redirect-${runtime}-`));
const $q = $({ mirror: false, capture: true });

async function probe(label, run, file) {
  const r = await run();
  const exists = fs.existsSync(file);
  console.log(`[${runtime}] ${label.padEnd(28)} code=${r.code} stdout=${JSON.stringify(r.stdout)} file=${exists ? JSON.stringify(fs.readFileSync(file, 'utf8')) : 'MISSING'}`);
}

const f1 = path.join(dir, 'plain.txt');
await probe('echo x > f', () => $q`echo hello > ${f1}`, f1);

const f2 = path.join(dir, 'sequence.txt');
await probe('echo x > f ; true', () => $q`echo hello > ${f2} ; true`, f2);

const f3 = path.join(dir, 'system.txt');
await probe('sh -c echo x > f', () => $q`sh -c 'echo hello' > ${f3}`, f3);

const f4 = path.join(dir, 'append.txt');
await probe('echo x >> f', () => $q`echo hello >> ${f4}`, f4);

fs.rmSync(dir, { recursive: true, force: true });
