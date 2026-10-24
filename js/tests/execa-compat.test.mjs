import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { $ as native, execaCompat } from '../src/$.mjs';
import * as isolated from '../src/execa/index.mjs';

const require = createRequire(import.meta.url);

test('isolated and general Execa APIs share their implementation', () => {
  assert.equal(native.execa, isolated.execa);
  assert.equal(native.execaCompat(), isolated.execaCompat());
  assert.equal(execaCompat(), isolated.execaCompat());
  assert.equal(require('../src/$.cjs').$.execa, isolated.execa);
  assert.equal(require('../src/execa/index.cjs').execa, isolated.execa);
});

test('argv is executed directly without shell evaluation', async () => {
  const values = [
    '',
    'a b',
    'a"b',
    "a'b",
    '$HOME',
    'semi;colon',
    'line\nbreak',
  ];
  const { stdout } = await isolated.execa(process.execPath, [
    '-e',
    'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
    '--',
    ...values,
  ]);
  assert.deepEqual(JSON.parse(stdout), values);
});

test('returns a live subprocess with readable stdout and kill', async () => {
  const child = isolated.execa(process.execPath, ['-e', 'console.log("done")']);
  assert.equal(typeof child.kill, 'function');
  assert.ok(child.stdout);
  assert.equal((await child).stdout, 'done');
});

test('input reaches and closes stdin', async () => {
  const input = 'one\ntwo\n';
  const result = await isolated.execa(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    { input, stripFinalNewline: false }
  );
  assert.equal(result.stdout, input);
});
