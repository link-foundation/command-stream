const moduleUrl = process.argv[2];

if (typeof globalThis.gc !== 'function') {
  throw new Error('Run the memory fixture with --expose-gc');
}

globalThis.gc();
const before = process.memoryUsage();
await import(moduleUrl);
globalThis.gc();
await new Promise((resolve) => setImmediate(resolve));
globalThis.gc();
const after = process.memoryUsage();

process.stdout.write(
  JSON.stringify({
    heapUsedBytes: after.heapUsed - before.heapUsed,
    rssBytes: after.rss - before.rss,
  })
);
