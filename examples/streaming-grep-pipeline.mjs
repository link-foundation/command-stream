#!/usr/bin/env bun

// grep pipeline streaming

import { $ } from '../src/$.mjs';

console.log('grep pipeline streaming test:');

const start = Date.now();
let chunkCount = 0;
for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | grep -E '"type"'`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;
    if (chunkCount <= 3) {
      console.log(`[${elapsed}ms] Chunk ${chunkCount}`);
    }
  }
}
console.log(`Total: ${chunkCount} chunks`);
console.log(chunkCount >= 5 ? '✅ grep streaming works' : '❌ grep buffered');
