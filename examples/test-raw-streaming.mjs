#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Testing Raw Streaming (no jq) ===\n');

// Test 1: Simple pipe with cat (should not buffer)
console.log('Test 1: Streaming through cat (unbuffered):');
const start = Date.now();

const cmd = $`sh -c 'echo "line1"; sleep 0.5; echo "line2"; sleep 0.5; echo "line3"' | cat`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const data = chunk.data.toString().trim();
    if (data) {
      const lines = data.split('\n').filter(l => l);
      for (const line of lines) {
        console.log(`[${elapsed}ms] ${line}`);
      }
    }
  }
}

console.log('\n✅ Test complete');

// Test 2: grep (line-buffered by default)
console.log('\nTest 2: Streaming through grep:');
const start2 = Date.now();

const cmd2 = $`sh -c 'echo "match1"; sleep 0.5; echo "skip"; sleep 0.5; echo "match2"' | grep match`;

for await (const chunk of cmd2.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const data = chunk.data.toString().trim();
    if (data) {
      const lines = data.split('\n').filter(l => l);
      for (const line of lines) {
        console.log(`[${elapsed}ms] ${line}`);
      }
    }
  }
}

console.log('\n✅ Test complete');