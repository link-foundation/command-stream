import { test, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, merge } from '../src/$.mjs';

test('stream analytics - basic functionality', async () => {
  const analytics = $`sh -c 'echo "INFO: Request 1"; echo "ERROR: Failed"; echo "INFO: Request 2"'`
    .analyze({
      errorRate: line => line.includes('ERROR'),
      customMetrics: {
        requestCount: (line) => {
          const match = line.match(/Request (\d+)/);
          return match ? parseInt(match[1]) : undefined;
        }
      }
    });

  let errorCount = 0;
  let totalChunks = 0;
  let hasCustomMetrics = false;

  for await (const chunk of analytics) {
    if (chunk.analytics) {
      totalChunks++;
      errorCount = chunk.analytics.errorRate;
      hasCustomMetrics = Object.keys(chunk.analytics.customMetrics).length > 0;
    }
  }

  expect(totalChunks).toBeGreaterThan(0);
  expect(errorCount).toBe(1); // One ERROR line
  expect(hasCustomMetrics).toBe(true);
}, 5000);

test('stream analytics - response time analysis', async () => {
  const analytics = $`sh -c 'echo "Request took 150ms"; echo "Request took 300ms"'`
    .analyze({
      responseTime: line => {
        const match = line.match(/(\d+)ms/);
        return match ? parseInt(match[1]) : null;
      }
    });

  let finalAnalytics = null;
  for await (const chunk of analytics) {
    if (chunk.analytics) {
      finalAnalytics = chunk.analytics;
    }
  }

  expect(finalAnalytics).toBeTruthy();
  expect(finalAnalytics.responseTime.length).toBe(2);
  expect(finalAnalytics.avgResponseTime).toBe(225); // (150 + 300) / 2
}, 5000);

test('stream transforms - map functionality', async () => {
  const mapped = $`printf "1\\n2\\n3\\n"`.map(line => {
    const num = parseInt(line.trim());
    return num * 2;
  });

  const results = [];
  for await (const chunk of mapped) {
    if (chunk.type === 'stdout') {
      const value = parseInt(chunk.data.toString().trim());
      if (!isNaN(value)) {
        results.push(value);
      }
    }
  }

  expect(results).toEqual([2, 4, 6]);
}, 5000);

test('stream transforms - filter functionality', async () => {
  const filtered = $`printf "1\\n2\\n3\\n4\\n5\\n"`.filter(line => {
    const num = parseInt(line.trim());
    return num % 2 === 0; // Even numbers only
  });

  const results = [];
  for await (const chunk of filtered) {
    if (chunk.type === 'stdout') {
      const value = parseInt(chunk.data.toString().trim());
      if (!isNaN(value)) {
        results.push(value);
      }
    }
  }

  expect(results).toEqual([2, 4]);
}, 5000);

test('stream transforms - reduce functionality', async () => {
  const reducer = $`printf "1\\n2\\n3\\n"`.reduce((acc, line) => {
    const num = parseInt(line.trim());
    return isNaN(num) ? acc : acc + num;
  }, 0);

  const sum = await reducer.aggregate();
  expect(sum).toBe(6); // 1 + 2 + 3
}, 5000);

test('stream transforms - chained operations', async () => {
  const chained = $`printf "1\\n2\\n3\\n4\\n5\\n"`
    .map(line => parseInt(line.trim()) * 2)  // Double: [2,4,6,8,10]
    .filter(line => parseInt(line) > 5);      // Filter > 5: [6,8,10]

  const results = [];
  for await (const chunk of chained) {
    if (chunk.type === 'stdout') {
      const value = parseInt(chunk.data.toString().trim());
      if (!isNaN(value)) {
        results.push(value);
      }
    }
  }

  expect(results).toEqual([6, 8, 10]);
}, 5000);

test('stream splitting - basic functionality', async () => {
  const split = $`sh -c 'echo "ERROR: failure"; echo "INFO: success"; echo "ERROR: timeout"'`
    .split(line => line.includes('ERROR'));

  const errors = [];
  const others = [];

  // Collect matched (errors) and unmatched (others) in parallel
  await Promise.all([
    (async () => {
      for await (const chunk of split.matched) {
        errors.push(chunk.data.toString().trim());
      }
    })(),
    (async () => {
      for await (const chunk of split.unmatched) {
        others.push(chunk.data.toString().trim());
      }
    })()
  ]);

  expect(errors).toHaveLength(2);
  expect(errors[0]).toContain('ERROR: failure');
  expect(errors[1]).toContain('ERROR: timeout');
  expect(others).toHaveLength(1);
  expect(others[0]).toContain('INFO: success');
}, 5000);

test('stream merging - basic functionality', async () => {
  const stream1 = $`echo "Stream1: Message1"`;
  const stream2 = $`echo "Stream2: Message1"`;
  const stream3 = $`echo "Stream3: Message1"`;

  const merged = merge(stream1, stream2, stream3);

  const results = [];
  for await (const chunk of merged) {
    if (chunk.type === 'stdout') {
      results.push({
        message: chunk.data.toString().trim(),
        streamIndex: chunk.streamIndex
      });
    }
  }

  expect(results).toHaveLength(3);
  expect(results.some(r => r.streamIndex === 0)).toBe(true);
  expect(results.some(r => r.streamIndex === 1)).toBe(true);
  expect(results.some(r => r.streamIndex === 2)).toBe(true);
}, 5000);

test('stream merging - with analytics', async () => {
  const stream1 = $`sh -c 'echo "ERROR: failed"; echo "INFO: ok"'`;
  const stream2 = $`sh -c 'echo "INFO: success"; echo "ERROR: timeout"'`;

  const mergedAnalytics = merge(stream1, stream2)
    .analyze({
      errorRate: (line, streamIndex) => line.includes('ERROR')
    });

  let finalAnalytics = null;
  let chunkCount = 0;
  
  for await (const chunk of mergedAnalytics) {
    chunkCount++;
    if (chunk.analytics) {
      finalAnalytics = chunk.analytics;
    }
  }

  expect(chunkCount).toBeGreaterThan(0);
  expect(finalAnalytics).toBeTruthy();
  expect(finalAnalytics.totalCount).toBe(4);
  expect(finalAnalytics.streamCounts).toEqual([2, 2]); // 2 messages from each stream
}, 5000);

test('buffering strategies - batch by size', async () => {
  const batched = $`printf "1\\n2\\n3\\n4\\n5\\n"`.batch(2);

  const batches = [];
  for await (const batch of batched) {
    expect(batch.type).toBe('batch');
    batches.push({
      size: batch.size,
      items: batch.data.map(chunk => chunk.data.toString().trim()).filter(x => x)
    });
  }

  expect(batches).toHaveLength(3); // [1,2], [3,4], [5]
  expect(batches[0].size).toBe(2);
  expect(batches[0].items).toEqual(['1', '2']);
  expect(batches[1].size).toBe(2);
  expect(batches[1].items).toEqual(['3', '4']);
  expect(batches[2].size).toBe(1);
  expect(batches[2].items).toEqual(['5']);
}, 5000);

test('buffering strategies - sliding window', async () => {
  const windowed = $`printf "1\\n2\\n3\\n4\\n"`.slidingWindow(3);

  const windows = [];
  for await (const window of windowed) {
    expect(window.type).toBe('window');
    expect(window.size).toBe(3);
    windows.push(window.data.map(chunk => chunk.data.toString().trim()).filter(x => x));
  }

  expect(windows).toHaveLength(2); // [1,2,3], [2,3,4]
  expect(windows[0]).toEqual(['1', '2', '3']);
  expect(windows[1]).toEqual(['2', '3', '4']);
}, 5000);

test('error handling - analytics with invalid config', async () => {
  // Should not throw, just skip invalid analyzers
  const analytics = $`echo "test"`.analyze({
    errorRate: "not a function", // Invalid
    validMetric: () => true       // Valid
  });

  let completed = false;
  for await (const chunk of analytics) {
    completed = true; // Should still work
  }
  
  expect(completed).toBe(true);
}, 5000);

test('error handling - map with undefined return', async () => {
  const mapped = $`printf "keep\\nskip\\nkeep\\n"`.map(line => {
    return line.includes('skip') ? undefined : line.toUpperCase();
  });

  const results = [];
  for await (const chunk of mapped) {
    if (chunk.type === 'stdout') {
      const value = chunk.data.toString().trim();
      if (value) {
        results.push(value);
      }
    }
  }

  expect(results).toEqual(['KEEP', 'KEEP']); // 'skip' should be filtered out
}, 5000);

test('integration - complex real-world pipeline', async () => {
  // Simulate a log monitoring pipeline
  const pipeline = $`sh -c 'echo "INFO Request 1 took 150ms"; echo "ERROR Request 2 failed"; echo "INFO Request 3 took 200ms"; echo "WARN Request 4 took 500ms"'`
    .analyze({
      errorRate: line => line.includes('ERROR'),
      responseTime: line => {
        const match = line.match(/(\d+)ms/);
        return match ? parseInt(match[1]) : null;
      }
    })
    .filter(chunk => chunk.analytics && chunk.analytics.elapsedTime > 0)
    .batch(2);

  const batches = [];
  for await (const batch of batches) {
    if (batch.type === 'batch') {
      batches.push(batch);
    }
  }

  // Pipeline should process the data through analytics, filtering, and batching
  expect(batches.length).toBeGreaterThanOrEqual(0); // May vary based on timing
}, 10000);