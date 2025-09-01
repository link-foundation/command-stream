#!/usr/bin/env bun
// Debug script to test the specific pipeline error scenario

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testPipelineError() {
  console.log('=== Pipeline Error Debug ===');
  
  console.log('\n1. Initial state:');
  const initialListeners = process.listeners('SIGINT').length;
  console.log('Initial SIGINT listeners:', initialListeners);
  
  console.log('\n2. Running failing pipeline: echo "test" | exit 1 | cat');
  
  try {
    await $`echo "test" | exit 1 | cat`;
    console.log('Pipeline succeeded (unexpected)');
  } catch (e) {
    console.log('Pipeline failed as expected:', e.message, 'code:', e.code);
  }
  
  console.log('\n3. Immediately after pipeline:');
  console.log('SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n4. After 50ms wait:');
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log('SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n5. After 100ms total:');
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log('SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\n6. After 200ms total:');
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('SIGINT listeners:', process.listeners('SIGINT').length);
  
  console.log('\nFinal result:');
  console.log('Expected:', initialListeners);
  console.log('Actual:', process.listeners('SIGINT').length);
  console.log('Cleaned up properly:', process.listeners('SIGINT').length === initialListeners);
  
  // Show any remaining handlers
  const remaining = process.listeners('SIGINT');
  if (remaining.length > initialListeners) {
    console.log('\nRemaining handlers:');
    remaining.forEach((handler, i) => {
      const str = handler.toString();
      const isCommandStream = str.includes('activeProcessRunners') || 
                             str.includes('ProcessRunner') ||
                             str.includes('activeChildren');
      console.log(`Handler ${i}: ${isCommandStream ? 'COMMAND-STREAM' : 'OTHER'} (${str.length} chars)`);
    });
  }
}

testPipelineError().catch(console.error);