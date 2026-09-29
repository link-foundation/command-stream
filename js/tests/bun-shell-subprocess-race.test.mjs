import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runSubprocess } from '../src/bun-shell/subprocess.mjs';

test(
  'subprocess observes exit and close emitted before the spawn await resumes',
  { timeout: 2000 },
  async () => {
    const child = new EventEmitter();
    child.pid = 123;
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;
    child.stdio = [];

    const result = await runSubprocess({
      args: ['short-lived-command'],
      cwd: process.cwd(),
      env: process.env,
      io: {
        stdin: { kind: 'ignore' },
        stdout: { kind: 'pipe' },
        stderr: { kind: 'pipe' },
      },
      flags: 0,
      shell: {
        bufferedStdout: { append() {} },
        bufferedStderr: { append() {} },
      },
      spawnChild() {
        globalThis.queueMicrotask(() => {
          child.emit('spawn');
          child.emit('exit', 0, null);
          child.emit('close', 0, null);
        });
        return child;
      },
    });

    assert.deepEqual(result, { exitCode: 0 });
  }
);

test(
  'subprocess captures output emitted before the spawn await resumes',
  { timeout: 2000 },
  async () => {
    const child = new EventEmitter();
    child.pid = 123;
    child.stdin = null;
    child.stdout = new EventEmitter();
    child.stderr = null;
    child.stdio = [null, child.stdout, null];
    const chunks = [];

    const result = await runSubprocess({
      args: ['short-lived-command'],
      cwd: process.cwd(),
      env: process.env,
      io: {
        stdin: { kind: 'ignore' },
        stdout: { kind: 'pipe' },
        stderr: { kind: 'ignore' },
      },
      flags: 0,
      shell: {
        bufferedStdout: { append: (bytes) => chunks.push(bytes) },
        bufferedStderr: { append() {} },
      },
      spawnChild() {
        globalThis.queueMicrotask(() => {
          child.emit('spawn');
          child.stdout.emit('data', Buffer.from('early output'));
          child.emit('exit', 0, null);
          child.emit('close', 0, null);
        });
        return child;
      },
    });

    assert.deepEqual(result, { exitCode: 0 });
    assert.equal(Buffer.concat(chunks).toString(), 'early output');
  }
);
