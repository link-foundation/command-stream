#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== JQ Streaming Debug ===');

console.log('Testing the exact command that was failing...');

const cmd = $`sh -c 'echo "{\\"id\\":1}"; sleep 0.5; echo "{\\"id\\":2}"; sleep 0.5; echo "{\\"id\\":3}"' | jq -c .`;

console.log('Getting stream...');

// Set a timeout to prevent infinite hang
const timeout = setTimeout(() => {
  console.log('TIMEOUT: JQ stream took too long');
  process.exit(1);
}, 10000);

try {
  let chunkCount = 0;
  let buffer = '';

  console.log('Starting stream iteration...');
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      chunkCount++;
      buffer += chunk.data.toString();

      console.log(
        `Chunk ${chunkCount}:`,
        JSON.stringify(chunk.data.toString())
      );

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          console.log('Complete line:', JSON.stringify(line.trim()));
        }
      }

      // Safety break after getting some output
      if (chunkCount >= 5) {
        console.log('Safety break after 5 chunks');
        break;
      }
    }
  }

  clearTimeout(timeout);
  console.log('JQ streaming completed with', chunkCount, 'chunks');
} catch (error) {
  clearTimeout(timeout);
  console.log('JQ streaming error:', error.message);
}
