// Finite probe for the CodeQL-reported shebang regex backtracking.
// Run with: node --max-old-space-size=128 js/experiments/fy-shebang-scaling.mjs
import { performance } from 'node:perf_hooks';
import { translateSource } from '../src/fy/index.mjs';
for (const count of [1024, 2048, 4096, 8192, 16384]) {
  const source = `#!${'\t'.repeat(count)}unknown\nprintf ok\n`;
  const start = performance.now();
  translateSource(source);
  console.log(`${count} tabs: ${(performance.now() - start).toFixed(2)} ms`);
}
