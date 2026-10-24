// Issue #227: `$({ timeout })` used to be accepted and silently ignored.
import { describe, expect, test } from 'bun:test';
import { $, ProcessRunner } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';

const elapsed = async (run) => {
  const started = Date.now();
  const result = await run();
  return { result, ms: Date.now() - started };
};

describe.skipIf(isWindows)('timeout option (#227)', () => {
  test('timeout bounds a command and reports timedOut', async () => {
    const { result, ms } = await elapsed(
      () => $({ mirror: false, timeout: 300 })`sleep 3`
    );
    expect(ms).toBeLessThan(2000);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(143);
    expect(result.signal).toBe('SIGTERM');
  });

  test('a command that finishes in time is not marked as timed out', async () => {
    const result = await $({ mirror: false, timeout: 5000 })`echo ok`;
    expect(String(result.stdout)).toBe('ok\n');
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test('results without a timeout report timedOut: false', async () => {
    const result = await $({ mirror: false })`true`;
    expect(result.timedOut).toBe(false);
  });

  test('timeout honours killSignal', async () => {
    const result = await $({
      mirror: false,
      timeout: 200,
      killSignal: 'SIGINT',
    })`sleep 3`;
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGINT');
    expect(result.code).toBe(130);
  });

  test('timeout combines with an external signal', async () => {
    const controller = new AbortController();
    const pending = $({
      mirror: false,
      timeout: 5000,
      signal: controller.signal,
    })`sleep 3`;
    setTimeout(() => controller.abort(), 100);
    const { result, ms } = await elapsed(() => pending);
    expect(ms).toBeLessThan(2000);
    expect(result.timedOut).toBe(false);

    const timed = await $({
      mirror: false,
      timeout: 200,
      signal: new AbortController().signal,
    })`sleep 3`;
    expect(timed.timedOut).toBe(true);
  });

  test('timeout bounds pipelines and streaming', async () => {
    const { result, ms } = await elapsed(
      () => $({ mirror: false, timeout: 300 })`sleep 3 | cat`
    );
    expect(ms).toBeLessThan(2000);
    expect(result.timedOut).toBe(true);

    const runner = $({ mirror: false, timeout: 300 })`sleep 3`;
    const started = Date.now();
    const chunks = [];
    for await (const chunk of runner.stream()) {
      chunks.push(chunk);
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(runner.result.timedOut).toBe(true);
  });

  test('timeout bounds exact-argv runners', async () => {
    const runner = new ProcessRunner(
      { mode: 'exec', file: 'sleep', args: ['3'] },
      { mirror: false, timeout: 300 }
    );
    const { result, ms } = await elapsed(() => runner);
    expect(ms).toBeLessThan(2000);
    expect(result.timedOut).toBe(true);
  });

  test('timeout bounds sync mode', () => {
    const started = Date.now();
    const result = $({ mirror: false, timeout: 300 })`sleep 3`.sync();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGTERM');
  });

  test('the timer does not keep a finished command alive', async () => {
    const started = Date.now();
    await $({ mirror: false, timeout: 60_000 })`true`;
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('invalid timeout values are rejected', async () => {
    for (const timeout of [-1, Number.NaN, Infinity, '500']) {
      await expect(
        Promise.resolve().then(() => $({ mirror: false, timeout })`true`)
      ).rejects.toThrow(TypeError);
    }
  });
});
