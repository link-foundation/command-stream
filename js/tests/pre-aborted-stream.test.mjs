import { describe, expect, test } from 'bun:test';
import './test-helper.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { $ } from '../src/$.mjs';
import { ProcessRunner } from '../src/process-runner.mjs';

const factories = [
  ['template command', (options) => $(options)`sleep 5`],
  [
    'shell file/args runner',
    (options) =>
      new ProcessRunner(
        {
          mode: 'shell',
          file: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 1000)'],
        },
        options
      ),
  ],
  [
    'exec runner',
    (options) =>
      new ProcessRunner(
        {
          mode: 'exec',
          file: process.execPath,
          args: ['-e', 'setTimeout(() => {}, 1000)'],
        },
        options
      ),
  ],
];

async function collect(iterator) {
  const chunks = [];
  for await (const chunk of iterator) {
    chunks.push(chunk);
  }
  return chunks;
}

async function expectCancelledStream(runner, iterator = runner.stream()) {
  const chunks = await collect(iterator);
  const result = await runner;
  expect(chunks).toEqual([
    { type: 'exit', code: result.code, signal: result.signal },
  ]);
  expect(result.code).toBe(143);
  expect(result.signal).toBe('SIGTERM');
  expect(runner.finished).toBe(true);
  expect(runner._child).toBeNull();
  for (const event of ['data', 'exit', 'end']) {
    expect(runner.listeners.get(event)?.length ?? 0).toBe(0);
  }
}

describe('issue #207: stream completion with an already-aborted signal', () => {
  test.each(factories)(
    '%s yields one exit chunk and ends without spawning',
    async (_name, factory) => {
      const runner = factory({ signal: AbortSignal.abort(), mirror: false });
      await expectCancelledStream(runner);
    },
    2000
  );

  test('implicit async iteration honors the configured killSignal', async () => {
    const runner = $({
      signal: AbortSignal.abort(),
      killSignal: 'SIGINT',
      mirror: false,
    })`sleep 5`;
    expect(await collect(runner)).toEqual([
      { type: 'exit', code: 130, signal: 'SIGINT' },
    ]);
    expect((await runner).code).toBe(130);
  }, 2000);

  test('stream() ends after start() receives an already-aborted signal', async () => {
    const runner = $({ mirror: false })`sleep 5`;
    await runner.start({ signal: AbortSignal.abort() });
    await expectCancelledStream(runner);
  }, 2000);

  test('stream() ends after an already-aborted runner was awaited', async () => {
    const runner = $({ signal: AbortSignal.abort(), mirror: false })`sleep 5`;
    await runner;
    await expectCancelledStream(runner);
  }, 2000);

  test('stream() ends when kill() ran before iteration began', async () => {
    const runner = $({ mirror: false })`sleep 5`;
    runner.kill();
    await expectCancelledStream(runner);
  }, 2000);

  test('stream() reports the stored exit code of a completed command', async () => {
    const runner = $({ mirror: false })`echo done`;
    const result = await runner;
    expect(await collect(runner.stream())).toEqual([
      { type: 'exit', code: result.code, signal: null },
    ]);
    expect(result.code).toBe(0);
  }, 2000);

  test('aborting after start still yields exactly one exit chunk', async () => {
    const controller = new AbortController();
    const runner = new ProcessRunner(
      {
        mode: 'exec',
        file: process.execPath,
        args: ['-e', "console.log('ready'); setTimeout(() => {}, 1000)"],
      },
      { signal: controller.signal, mirror: false }
    );
    const chunks = [];
    for await (const chunk of runner.stream()) {
      chunks.push(chunk);
      if (chunk.type === 'stdout') {
        controller.abort();
      }
    }
    expect(chunks.some((chunk) => chunk.type === 'stdout')).toBe(true);
    expect(chunks.filter((chunk) => chunk.type === 'exit')).toEqual([
      { type: 'exit', code: 143, signal: 'SIGTERM' },
    ]);
    expect((await runner).code).toBe(143);
  }, 5000);

  test('the standalone reproduction also completes under Node.js', () => {
    const script = fileURLToPath(
      new URL(
        '../../experiments/issue-207/pre-aborted-stream.mjs',
        import.meta.url
      )
    );
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      env: { ...process.env, COMMAND_STREAM_TRACE: 'false' },
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: both streams yielded exit code 143');
  }, 5000);
});
