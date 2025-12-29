#!/usr/bin/env bun

// Virtual command with pipeline

import { $ } from '../js/src/$.mjs';

console.log('Virtual command with jq pipeline:');

const start = Date.now();
let chunkCount = 0;
for await (const chunk of $`echo '{"test":1}' | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;
    console.log(`[${elapsed}ms] Chunk ${chunkCount}`);
  }
}
console.log(`Total: ${chunkCount} chunks`);
