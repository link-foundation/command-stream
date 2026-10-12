import { test, expect, beforeEach, afterEach } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $, command, stream, merge } from '../src/$.mjs';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);

const numbers = () =>
  command(process.execPath, '-e', "console.log('1\\n2\\n3\\n4\\n5')").with({
    mirror: false,
    capture: false,
  });

test('command pipelines transform lines, reduce and await alerts', async () => {
  const batches = [];
  await numbers()
    .stream()
    .map(async (line) => Number(line) * 2)
    .filter(async (value) => value > 5)
    .batch(2)
    .forEach(async (batch) => {
      batches.push(batch);
    });
  expect(batches).toEqual([[6, 8], [10]]);
  expect(
    await numbers()
      .stream()
      .reduce((sum, line) => sum + Number(line), 0)
  ).toBe(15);
}, 5000);

test('command analytics report error fractions and finite response samples', async () => {
  const counts = [];
  const stats = await command(
    process.execPath,
    '-e',
    "console.log('OK 10\\nERROR 30\\nOK invalid')"
  )
    .with({ mirror: false, capture: false })
    .stream()
    .analyze({
      errorRate: (line) => line.startsWith('ERROR'),
      responseTime: (line) => Number(line.split(' ')[1]),
      onUpdate: (stats) => {
        counts.push(stats.count);
      },
    });
  expect(stats.count).toBe(3);
  expect(stats.errors).toBe(1);
  expect(stats.errorRate).toBeCloseTo(1 / 3);
  expect(stats.responseTime).toEqual({ count: 2, mean: 20, min: 10, max: 30 });
  expect(stats.throughput).toBeGreaterThan(0);
  expect(counts).toEqual([1, 2, 3]);
}, 5000);

test('bounded command splits and merges preserve every line', async () => {
  const [odd, even] = numbers()
    .stream()
    .split((line) => Number(line) % 2, { highWaterMark: 1 });
  expect(await Promise.all([odd.toArray(), even.toArray()])).toEqual([
    ['1', '3', '5'],
    ['2', '4'],
  ]);
  const values = await $.merge(
    numbers().stream().lines(),
    stream(['other'])
  ).toArray();
  expect(values.sort()).toEqual(['1', '2', '3', '4', '5', 'other']);
  expect(await merge(stream([]), stream([1])).toArray()).toEqual([1]);
}, 5000);

test('sliding windows keep only the requested number of items', async () => {
  expect(await numbers().stream().slidingWindow(3).toArray()).toEqual([
    ['1', '2', '3'],
    ['2', '3', '4'],
    ['3', '4', '5'],
  ]);
}, 5000);

test('timed batches flush while the source is idle and retain the pending read', async () => {
  let release;
  let reads = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const source = stream(
    (async function* () {
      reads++;
      yield 1;
      await gate;
      reads++;
      yield 2;
      reads++;
      yield 3;
    })()
  );
  const batches = source.batch(10, 20);
  const pending = batches.next();
  try {
    const first = await Promise.race([pending, delay(500).then(() => null)]);
    expect(first).toEqual({ done: false, value: [1] });
    expect(reads).toBe(1);
    release();
    expect(await batches.toArray()).toEqual([[2, 3]]);
  } finally {
    release();
    await pending;
    await batches.return();
  }
}, 3000);

test('timed batching remains pull-driven and flushes full and final batches', async () => {
  let produced = 0;
  const source = stream(
    (async function* () {
      for (let value = 1; value <= 5; value++) {
        produced++;
        yield value;
      }
    })()
  );
  const batches = source.batch(2, 100);
  expect((await batches.next()).value).toEqual([1, 2]);
  await delay(20);
  expect(produced).toBe(2);
  expect(await batches.toArray()).toEqual([[3, 4], [5]]);
}, 3000);

test('timed batches propagate source errors and close upstream', async () => {
  let closed = false;
  const failure = new Error('source failed');
  const batches = stream(
    (async function* () {
      try {
        yield 1;
        throw failure;
      } finally {
        closed = true;
      }
    })()
  ).batch(10, 100);
  await expect(batches.next()).rejects.toThrow('source failed');
  expect(closed).toBe(true);
}, 3000);

test('timed batching rejects invalid deadlines', () => {
  for (const deadline of [0, -1, NaN, Infinity, 2147483648]) {
    expect(() => stream([1]).batch(2, deadline)).toThrow(RangeError);
  }
});

test('a timed batch cancels its idle command when a consumer exits early', async () => {
  const runner = command(
    process.execPath,
    '-e',
    "console.log('ready'); setTimeout(() => {}, 2000)"
  )
    .with({ mirror: false, capture: false })
    .runner();
  try {
    expect(await runner.stream().batch(10, 20).take(1).toArray()).toEqual([
      ['ready'],
    ]);
    expect(runner.finished).toBe(true);
  } finally {
    runner.kill();
  }
}, 5000);

test('empty timed sources and size-one batches never emit empty arrays', async () => {
  expect(await stream([]).batch(3, 20).toArray()).toEqual([]);
  expect(await stream([1, 2, 3]).batch(1, 20).toArray()).toEqual([
    [1],
    [2],
    [3],
  ]);
}, 3000);

test('deadline batches flush continuously ready input without waiting for timer callbacks', async () => {
  const input = Array.from({ length: 10 }, (_, index) => index);
  const batches = stream(input)
    .map((value) => {
      const end = performance.now() + 2;
      while (performance.now() < end) {
        /* finite CPU work delays timer callbacks */
      }
      return value;
    })
    .batch(100, 1);
  const first = (await batches.next()).value;
  expect(first.length).toBeLessThan(input.length);
  expect([...first, ...(await batches.toArray()).flat()]).toEqual(input);
}, 3000);
