// Isolated Node process: mock Windows APIs without modifying the Bun suite.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { attachStreamKillMethods } from '../src/$.process-runner-stream-kill.mjs';

class Runner {
  options = { killGrace: 100 };
  _child = { pid: 12345 };
  finish(result) {
    this.result = result;
    this.finished = true;
  }
}
attachStreamKillMethods(Runner);

for (const [name, result] of [
  ['success', { status: 0 }],
  ['nonzero exit', { status: 1 }],
  ['spawn error', { status: null, error: new Error('taskkill unavailable') }],
]) {
  test(`Windows tree cancellation handles taskkill ${name}`, () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalSpawn = childProcess.spawnSync;
    const originalKill = process.kill;
    const originalTimer = globalThis.setTimeout;
    const calls = [];
    const signals = [];
    const timers = [];
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      childProcess.spawnSync = (...args) => {
        calls.push(args);
        return result;
      };
      syncBuiltinESMExports();
      process.kill = (...args) => signals.push(args);
      globalThis.setTimeout = (...args) => {
        timers.push(args);
        return { unref() {} };
      };
      const runner = new Runner();
      runner.kill('SIGINT');

      assert.deepEqual(calls, [
        [
          'taskkill',
          ['/PID', '12345', '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
          },
        ],
      ]);
      assert.deepEqual(
        signals,
        result.status === 0 ? [] : [[12345, 'SIGKILL']]
      );
      // taskkill already forces termination. A later PID-based retry could
      // target an unrelated process if Windows reuses the terminated PID.
      assert.equal(timers.length, 0);
      assert.equal(runner.result.code, 130);
      assert.equal(runner.finished, true);
    } finally {
      Object.defineProperty(process, 'platform', platform);
      childProcess.spawnSync = originalSpawn;
      process.kill = originalKill;
      globalThis.setTimeout = originalTimer;
      syncBuiltinESMExports();
    }
  });
}
