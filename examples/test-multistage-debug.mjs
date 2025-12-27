#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Debug Multi-Stage Pipeline ===\n');

console.log('Testing: emulate | cat | jq');
const start = Date.now();
let chunkCount = 0;
let firstChunkTime = null;
let lastChunkTime = null;

for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | cat | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    chunkCount++;
    const elapsed = Date.now() - start;

    if (!firstChunkTime) {
      firstChunkTime = elapsed;
    }
    lastChunkTime = elapsed;

    console.log(
      `[${elapsed}ms] Chunk ${chunkCount}: ${chunk.data.length} bytes`
    );
  }
}

console.log(`\nSummary:`);
console.log(`- Total chunks: ${chunkCount}`);
console.log(`- First chunk at: ${firstChunkTime}ms`);
console.log(`- Last chunk at: ${lastChunkTime}ms`);
console.log(`- Time span: ${lastChunkTime - firstChunkTime}ms`);

if (chunkCount === 1) {
  console.log('\n❌ All output was buffered into a single chunk');
  console.log('This means jq collected all input before producing output');
} else if (lastChunkTime - firstChunkTime < 100) {
  console.log('\n⚠️  Chunks arrived very close together (< 100ms span)');
  console.log('This suggests partial buffering');
} else {
  console.log('\n✅ Real-time streaming is working!');
  console.log('Chunks arrived over time as expected');
}
