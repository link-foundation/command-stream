#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

console.log('=== Testing Incremental Streaming ===\n');

// Test: Does output stream incrementally?
console.log('Each line should appear with 500ms delay between them:\n');
const start = Date.now();

const cmd = $`sh -c 'echo "line1"; sleep 0.5; echo "line2"; sleep 0.5; echo "line3"'`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data
      .toString()
      .trim()
      .split('\n')
      .filter((l) => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}

console.log('\n--- Now testing with pipe ---\n');

const start2 = Date.now();
const cmd2 = $`sh -c 'echo "line1"; sleep 0.5; echo "line2"; sleep 0.5; echo "line3"' | cat`;

for await (const chunk of cmd2.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const lines = chunk.data
      .toString()
      .trim()
      .split('\n')
      .filter((l) => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}

console.log('\n✅ Test complete');
