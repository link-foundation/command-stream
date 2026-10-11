import { stream } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'stream-processing', title: 'Process streams incrementally' },
  async ({ record }) => {
    record(
      'batches',
      await stream([1, 2, 3, 4, 5])
        .filter((value) => value % 2 === 1)
        .map((value) => value * 2)
        .batch(2)
        .toArray()
    );
    const stats = await stream([10, 30]).analyze({
      errorRate: (value) => value > 20,
      responseTime: (value) => value,
    });
    record('timed batches', await stream([1, 2, 3]).batch(2, 500).toArray());
    record(
      'sliding windows',
      await stream([1, 2, 3]).slidingWindow(2).toArray()
    );
    record('error rate', stats.errorRate);
    record('mean response time', stats.responseTime.mean);
  }
);
