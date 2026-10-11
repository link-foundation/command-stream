#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Basic Streaming Debug ===');

console.log('1. Testing await pattern:');
const result1 = await $`echo "test1"`;
console.log('Await result:', result1.stdout.trim());

console.log('2. Testing stream pattern:');
const chunks = [];
const cmd = $`echo "test2"`;
try {
  for await (const chunk of cmd.stream()) {
    chunks.push(chunk);
    console.log(
      'Stream chunk:',
      chunk.type,
      JSON.stringify(chunk.data.toString().trim())
    );
  }
  console.log('Stream completed, chunks:', chunks.length);
} catch (e) {
  console.log('Stream error:', e.message);
}

console.log('3. Testing stream with command that produces multiple lines:');
const cmd2 = $`sh -c 'echo "line1"; echo "line2"'`;
let count = 0;
for await (const chunk of cmd2.stream()) {
  count++;
  console.log(
    `Chunk ${count}:`,
    chunk.type,
    JSON.stringify(chunk.data.toString().trim())
  );
  if (count >= 10) {
    console.log('Breaking after 10 chunks to prevent infinite loop');
    break;
  }
}

console.log('Debug script completed successfully!');
