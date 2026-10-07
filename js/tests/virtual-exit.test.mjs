import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { $, register, resetGlobalState, set, unregister } from '../src/$.mjs';

beforeEach(() => resetGlobalState());
afterEach(() => {
  unregister('issue213after');
  unregister('issue213error');
  resetGlobalState();
});

for (const errexit of [false, true]) {
  for (const code of [0, 7]) {
    test(
      `virtual exit ${code}, errexit=${errexit}`,
      { timeout: 5000 },
      async () => {
        if (errexit) {
          set('e');
        }
        const runner = $({ mirror: false })`exit ${code}`;
        const data = [];
        const exits = [];
        runner.on('data', (chunk) => data.push(chunk));
        runner.on('exit', (status) => exits.push(status));

        if (errexit && code !== 0) {
          await assert.rejects(runner, (error) => {
            assert.equal(error.code, code);
            assert.equal(error.exitCode, code);
            assert.equal(error.stderr, '');
            assert.equal(error.result.code, code);
            assert.equal(error.result.exitCode, code);
            assert.equal(error.result.stdout, '');
            assert.equal(error.result.stderr, '');
            return true;
          });
        } else {
          const result = await runner;
          assert.equal(result.code, code);
          assert.equal(result.exitCode, code);
          assert.equal(result.stdout.toString(), '');
          assert.equal(result.stderr.toString(), '');
        }
        assert.deepEqual(data, []);
        assert.deepEqual(exits, [code]);
        assert.equal(runner.result.stderr, '');
      }
    );
  }
}

test(
  'exit without an argument succeeds under errexit',
  { timeout: 5000 },
  async () => {
    set('e');
    const result = await $({ mirror: false })`exit`;
    assert.equal(result.code, 0);
    assert.equal(result.stderr.toString(), '');
  }
);

test(
  'a failing exit stops a sequence under errexit',
  { timeout: 5000 },
  async () => {
    set('e');
    let ranAfter = false;
    register('issue213after', async () => {
      ranAfter = true;
      return { code: 0, stdout: 'after' };
    });
    await assert.rejects(
      $({ mirror: false })`exit 3; issue213after`,
      (error) => {
        assert.equal(error.code, 3);
        assert.equal(error.result.stderr, '');
        return true;
      }
    );
    assert.equal(ranAfter, false);
  }
);

test(
  'unexpected virtual errors retain their diagnostic stderr',
  { timeout: 5000 },
  async () => {
    register('issue213error', async () => {
      throw new Error('unexpected handler failure');
    });
    const result = await $({ mirror: false })`issue213error`;
    assert.equal(result.code, 1);
    assert.equal(result.stderr.toString(), 'unexpected handler failure');
  }
);

test(
  'caught exit statuses never reach parent stderr',
  { timeout: 10000 },
  () => {
    const probe = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            '../../experiments/issue-213/virtual-exit.mjs',
            import.meta.url
          )
        ),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, COMMAND_STREAM_TRACE: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      }
    );
    assert.ifError(probe.error);
    assert.equal(probe.status, 0);
    assert.equal(probe.stderr, '');
    const observations = JSON.parse(probe.stdout);
    assert.deepEqual(
      observations.map(({ rejected, code, stderr }) => ({
        rejected,
        code,
        stderr,
      })),
      [
        { rejected: true, code: 7, stderr: '' },
        { rejected: true, code: 7, stderr: '' },
        { rejected: true, code: 7, stderr: '' },
        { rejected: true, code: 7, stderr: '' },
        { rejected: false, code: 0, stderr: '' },
        { rejected: false, code: 0, stderr: '' },
        { rejected: true, code: 3, stderr: '' },
        { rejected: false, code: 0, stderr: '' },
        { rejected: false, code: 7, stderr: '' },
      ]
    );
  }
);
