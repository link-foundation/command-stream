#!/usr/bin/env node

import assert from 'node:assert/strict';
import { once } from 'node:events';
import $, { ProcessRunner } from '../src/$.mjs';

// Both Bun and Node can run this fixture through process.execPath.
const program =
  "process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 40)";

const child = $.spawn(process.execPath, ['-e', program]);
let nativeFirstChunkBeforeClose = false;
let nativeClosed = false;
child.stdout.on('data', (chunk) => {
  if (chunk.toString().includes('first') && !nativeClosed) {
    nativeFirstChunkBeforeClose = true;
  }
});
const [nativeCode] = await once(child, 'close');
nativeClosed = true;
assert.equal(nativeCode, 0);
assert.equal(nativeFirstChunkBeforeClose, true);

const buffered = $.spawn.sync(process.execPath, ['-e', program], {
  encoding: 'utf8',
});
assert.equal(buffered.status, 0);
assert.equal(buffered.stdout, 'first\nsecond\n');

const runner = new ProcessRunner(
  { mode: 'exec', file: process.execPath, args: ['-e', program] },
  { capture: false, mirror: false, stdin: 'ignore' }
);
const chunks = [];
for await (const chunk of runner.stream()) {
  if (chunk.type === 'stdout') {
    chunks.push(chunk.data.toString());
  }
}
assert.equal(chunks.join(''), 'first\nsecond\n');

console.log('Native ChildProcess output arrived before close.');
console.log('Synchronous output was buffered.');
console.log('ProcessRunner supplied the same output through async iteration.');
