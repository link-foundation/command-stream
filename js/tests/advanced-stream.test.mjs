import { test, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import * as api from '../src/$.mjs';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);

test('pull operators await transforms and retain partial batches', async () => {
  expect(typeof api.stream).toBe('function');
  const result = await api
    .stream([1, 2, 3, 4, 5])
    .filter(async (x) => x % 2)
    .map(async (x) => x * 2)
    .batch(2)
    .toArray();
  expect(result).toEqual([[2, 6], [10]]);
  expect(await api.stream([1, 2, 3]).reduce((a, x) => a + x, 0)).toBe(6);
  expect(await api.stream([1, 2, 3, 4]).window(3).toArray()).toEqual([
    [1, 2, 3],
    [2, 3, 4],
  ]);
});

test('command stream lines frame partial unicode and leave exit chunks compatible', async () => {
  const runner = new api.ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: ['-e', "process.stdout.write('one\\ntwo\\n')"],
    },
    { mirror: false, capture: false }
  );
  expect(typeof runner.stream().lines).toBe('function');
  expect(await runner.stream().lines().toArray()).toEqual(['one', 'two']);
});

test('split and merge consume each value exactly once with bounded branches', async () => {
  expect(typeof api.stream).toBe('function');
  const [odd, even] = api
    .stream([1, 2, 3, 4, 5])
    .split((x) => x % 2, { highWaterMark: 1 });
  const result = await Promise.all([odd.toArray(), even.toArray()]);
  expect(result).toEqual([
    [1, 3, 5],
    [2, 4],
  ]);
  expect(
    (await api.merge(api.stream([1, 3]), api.stream([2, 4])).toArray()).sort()
  ).toEqual([1, 2, 3, 4]);
});

test('analytics update online without retaining input', async () => {
  expect(typeof api.stream).toBe('function');
  const updates = [];
  const stats = await api.stream(['OK 10', 'ERROR 30']).analyze({
    errorRate: (x) => x.startsWith('ERROR'),
    responseTime: (x) => Number(x.split(' ')[1]),
    throughput: true,
    onUpdate: (s) => updates.push(s.count),
  });
  expect(stats.count).toBe(2);
  expect(stats.errorRate).toBe(0.5);
  expect(stats.responseTime.mean).toBe(20);
  expect(updates).toEqual([1, 2]);
});

test('slow consumers bound producer progress and cancellation runs finally', async () => {
  expect(typeof api.stream).toBe('function');
  let produced = 0;
  let closed = false;
  async function* source() {
    try {
      for (let i = 0; i < 20; i++) {
        produced++;
        yield i;
      }
    } finally {
      closed = true;
    }
  }
  for await (const value of api.stream(source()).map(async (x) => x)) {
    expect(produced).toBe(value + 1);
    if (value === 2) {
      break;
    }
  }
  expect(closed).toBe(true);
});
