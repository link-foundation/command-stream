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
