#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Virtual vs Real Commands Debug ===');

console.log('1. Testing with virtual commands enabled:');
const cmd1 = $`echo "virtual test"`;

cmd1.on('end', (result) => {
  console.log('[VIRTUAL] end event:', result.code);
});

const result1 = await cmd1;
console.log('[VIRTUAL] await result:', result1.code, JSON.stringify(result1.stdout.trim()));

console.log('2. Testing with virtual commands disabled:');
disableVirtualCommands();

const cmd2 = $`echo "real test"`;

cmd2.on('end', (result) => {
  console.log('[REAL] end event:', result.code);
});

const result2 = await cmd2;
console.log('[REAL] await result:', result2.code, JSON.stringify(result2.stdout.trim()));

console.log('3. Testing stream with virtual commands disabled:');
const cmd3 = $`echo "real stream test"`;
let streamEndFired = false;

cmd3.on('end', (result) => {
  streamEndFired = true;
  console.log('[REAL STREAM] end event:', result.code);
});

console.log('Starting stream...');
try {
  const chunks = [];
  for await (const chunk of cmd3.stream()) {
    chunks.push(chunk);
    console.log('[REAL STREAM] chunk:', chunk.type, JSON.stringify(chunk.data.toString().trim()));
    
    // Break after receiving data to see if end event fires
    if (chunks.length >= 1) {
      console.log('[REAL STREAM] Breaking after first chunk');
      break;
    }
  }
  console.log('[REAL STREAM] Stream completed, end fired?', streamEndFired);
} catch (error) {
  console.log('[REAL STREAM] Error:', error.message);
}

console.log('Debug completed!');
