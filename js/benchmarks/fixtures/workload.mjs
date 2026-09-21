import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function sourceDigest(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name)
    .sort();
  const hash = createHash('sha256');
  for (const name of names) {
    hash.update(name);
    hash.update(await readFile(join(directory, name)));
  }
  return `${names.length}:${hash.digest('hex')}`;
}

async function summarizeLog(filename) {
  const counts = { INFO: 0, WARN: 0, ERROR: 0 };
  for (const line of (await readFile(filename, 'utf8')).trim().split('\n')) {
    const level = line.split(' ')[1];
    if (Object.hasOwn(counts, level)) {
      counts[level] += 1;
    }
  }
  return JSON.stringify(counts);
}

async function digestFiles(directory) {
  const names = (await readdir(directory)).sort();
  const hash = createHash('sha256');
  for (const name of names) {
    hash.update(name);
    hash.update(await readFile(join(directory, name)));
  }
  return `${names.length}:${hash.digest('hex')}`;
}

async function countStdin() {
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
  }
  return bytes;
}

async function main([mode, ...args]) {
  if (mode === 'echo') {
    process.stdout.write(JSON.stringify(args));
    return;
  }
  if (mode === 'emit') {
    const bytes = Number.parseInt(args[0], 10);
    process.stdout.write(Buffer.alloc(bytes, 120));
    return;
  }
  if (mode === 'stdin-count') {
    process.stdout.write(String(await countStdin()));
    return;
  }
  if (mode === 'fail') {
    process.stderr.write('intentional benchmark failure');
    process.exitCode = Number.parseInt(args[0], 10);
    return;
  }
  if (mode === 'package-version') {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'));
    process.stdout.write(manifest.version);
    return;
  }
  if (mode === 'source-digest') {
    process.stdout.write(await sourceDigest(args[0]));
    return;
  }
  if (mode === 'log-summary') {
    process.stdout.write(await summarizeLog(args[0]));
    return;
  }
  if (mode === 'file-digest') {
    process.stdout.write(await digestFiles(args[0]));
    return;
  }
  if (mode === 'http-get') {
    const response = await fetch(args[0]);
    const body = await response.text();
    process.stdout.write(`${response.status}:${body}`);
    return;
  }
  throw new Error(`Unknown workload: ${mode}`);
}

await main(process.argv.slice(2));
