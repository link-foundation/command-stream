#!/usr/bin/env bun

// Multi-stage pipeline streaming (cat | jq)

import { $ } from '../src/$.mjs';

console.log('Multi-stage pipeline streaming test:');

const start = Date.now();
let chunkCount = 0;
for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | cat | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;
    if (chunkCount <= 3) {
      console.log(`[${elapsed}ms] Chunk ${chunkCount}`);
    }
  }
}
console.log(`Total: ${chunkCount} chunks`);
console.log(chunkCount >= 5 ? '✅ Multi-stage streaming works' : '❌ Multi-stage buffered');