#!/usr/bin/env bun

import { $ } from './$.mjs';

console.log('=== Debug Enhanced $ API ===\n');

try {
  console.log('Testing EventEmitter pattern...');
  
  const process = $`echo "test"`;
  
  process.on('data', (chunk) => {
    console.log('Data event:', chunk);
  });
  
  process.on('end', (result) => {
    console.log('End event:', result);
    console.log('✅ EventEmitter test completed');
  });
  
  // Also await to see what happens
  const result = await process;
  console.log('Await result:', result);
  
} catch (error) {
  console.error('❌ Error:', error.message);
}