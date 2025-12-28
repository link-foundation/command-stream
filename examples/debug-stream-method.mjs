#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Stream Method Debug ===');

const cmd = $`echo "test"`;

console.log('Getting stream generator...');
const stream = cmd.stream();

console.log('Starting iteration...');
let chunkCount = 0;

// Set a timeout to prevent infinite hang
const timeout = setTimeout(() => {
  console.log('TIMEOUT: Stream iteration took too long');
  process.exit(1);
}, 5000);

try {
  for await (const chunk of stream) {
    chunkCount++;
    console.log(
      `Chunk ${chunkCount}:`,
      chunk.type,
      JSON.stringify(chunk.data.toString().trim())
    );

    // Safety break
    if (chunkCount >= 3) {
      console.log('Safety break after 3 chunks');
      break;
    }
  }

  clearTimeout(timeout);
  console.log(
    'Stream iteration completed naturally with',
    chunkCount,
    'chunks'
  );
} catch (error) {
  clearTimeout(timeout);
  console.log('Stream iteration error:', error.message);
}
