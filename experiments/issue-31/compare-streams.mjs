// Finite API comparison against the exact versions in js/package.json.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { command } from '../../js/src/$.mjs';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { execa } = await import(require.resolve('execa'));
const { $: zx } = await import(require.resolve('zx'));
const { default: shell } = await import(require.resolve('shelljs'));
const script = 'console.log(1);console.log(2);console.log(3);console.log(4)';
const expected = [4, 8];
const results = {};

results.commandStream = await command(process.execPath, '-e', script)
  .with({ capture: false, mirror: false })
  .stream()
  .filter((line) => Number(line) % 2 === 0)
  .map((line) => Number(line) * 2)
  .toArray();
results.nodeReadable = await Readable.from([1, 2, 3, 4])
  .filter((value) => value % 2 === 0)
  .map((value) => value * 2)
  .toArray();

function* transform(line) {
  if (line.trim() && Number(line) % 2 === 0) {
    yield String(Number(line) * 2);
  }
}
results.execa = [];
for await (const line of execa(process.execPath, ['-e', script], {
  stdout: transform,
  buffer: false,
})) {
  results.execa.push(Number(line));
}
results.zx = [];
for await (const line of zx({
  quiet: true,
})`${process.execPath} -e ${script}`) {
  if (line.trim() && Number(line) % 2 === 0) {
    results.zx.push(Number(line) * 2);
  }
}
results.shelljsAsync = [];
const child = shell.exec(`node -e "${script}"`, { async: true, silent: true });
for await (const line of createInterface({ input: child.stdout })) {
  if (line.trim() && Number(line) % 2 === 0) {
    results.shelljsAsync.push(Number(line) * 2);
  }
}
if (process.versions.bun) {
  const { $ } = await import('bun');
  results.bunShell = [];
  for await (const line of $`${process.execPath} -e ${script}`
    .quiet()
    .lines()) {
    if (line.trim() && Number(line) % 2 === 0) {
      results.bunShell.push(Number(line) * 2);
    }
  }
}
for (const [name, result] of Object.entries(results)) {
  assert.deepEqual(result, expected, name);
}
console.log(JSON.stringify({ runtime: process.version, results }, null, 2));
