import { expect, test } from 'bun:test';
import { compareOutputModes } from '../benchmarks/shelljs-streaming.mjs';

test('ShellJS comparison validates complete output in all three modes', async () => {
  const report = await compareOutputModes({ chunks: 2, bytes: 32, delay: 1 });
  expect(report.observations).toHaveLength(3);
  for (const observation of report.observations) {
    expect(observation.received).toBe(64);
    expect(observation.code).toBe(0);
    expect(observation.firstByteMs).toBeLessThanOrEqual(observation.totalMs);
  }
}, 10000);
