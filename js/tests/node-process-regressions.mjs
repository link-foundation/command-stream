// Node-specific process regressions run in the Node 20/22/24 CI matrix.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, test } from 'node:test';

import { exec, ProcessRunner, resetGlobalState, set } from '../src/$.mjs';

const processOptions = {
  capture: true,
  mirror: false,
  stdin: 'ignore',
};

function missingExecutable() {
  return join(
    tmpdir(),
    `command-stream-node-missing-${process.pid}-${Date.now()}${process.platform === 'win32' ? '.exe' : ''}`
  );
}

afterEach(() => resetGlobalState());

test('explicit stdin is written exactly once in Node.js', async () => {
  const input = 'first line\nsecond line\n';
  const result = await exec(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    { ...processOptions, stdin: input }
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, input);
  assert.equal(result.stdin, input);
});

test('an unavailable exact executable returns an async result in Node.js', async () => {
  const result = await exec(missingExecutable(), [], processOptions);

  assert.equal(result.code, 127);
  assert.equal(result.exitCode, 127);
  assert.notEqual(result.stderr, '');
});

test('an unavailable exact executable returns a sync result in Node.js', () => {
  const result = new ProcessRunner(
    { mode: 'exec', file: missingExecutable(), args: [] },
    processOptions
  ).sync();

  assert.equal(result.code, 127);
  assert.equal(result.exitCode, 127);
  assert.notEqual(result.stderr, '');
});

test('an in-flight launch keeps its captured errexit setting', async () => {
  const completion = exec(missingExecutable(), [], processOptions);
  set('e');

  const result = await completion;
  assert.equal(result.code, 127);
});
