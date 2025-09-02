#!/usr/bin/env bun

// Basic streaming without pipes

import { $ } from '../src/$.mjs';

console.log('Direct command streaming test:');

const start = Date.now();
let chunkCount = 0;
for await (const chunk of $`bun run examples/emulate-claude-stream.mjs`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;
    if (chunkCount <= 3) {
      console.log(`[${elapsed}ms] Chunk ${chunkCount}`);
    }
  }
}
console.log(`Total: ${chunkCount} chunks`);
console.log(chunkCount >= 5 ? '✅ Streaming works' : '❌ Not streaming');