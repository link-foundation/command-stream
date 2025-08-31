#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Testing Real-Time jq Streaming ===\n');

console.log('Test: Emulated Claude stream with jq formatting');
const start = Date.now();
let lastTime = start;
let chunkCount = 0;

for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const now = Date.now();
    const elapsed = now - start;
    const delta = now - lastTime;
    lastTime = now;
    
    const text = chunk.data.toString().trim();
    if (text) {
      console.log(`[${elapsed}ms, +${delta}ms] Chunk ${chunkCount}:`);
      console.log(text);
      console.log('---');
    }
  }
}

console.log(`\nTotal chunks received: ${chunkCount}`);
console.log(`Total time: ${Date.now() - start}ms`);

if (chunkCount >= 5) {
  console.log('✅ SUCCESS: Real-time streaming is working! We received multiple chunks over time.');
} else if (chunkCount === 1) {
  console.log('❌ FAIL: All output was buffered into a single chunk.');
} else {
  console.log('⚠️  WARNING: Received fewer chunks than expected.');
}