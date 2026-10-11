#!/usr/bin/env bun

// jq pipeline streaming (critical test)

import { $ } from '../src/$.mjs';

console.log('jq pipeline streaming test:');

const start = Date.now();
let chunkCount = 0;
for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;
    if (chunkCount <= 3) {
      console.log(`[${elapsed}ms] Chunk ${chunkCount}`);
    }
  }
}
console.log(`Total: ${chunkCount} chunks`);
console.log(
  chunkCount >= 5 ? '✅ Streaming works with jq!' : '❌ jq buffered output'
);
