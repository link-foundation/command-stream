#!/usr/bin/env bun
// Debug script to see if our timer fix is working

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

let userHandlerCalled = false;

// Add user SIGINT handler FIRST
process.on('SIGINT', () => {
  userHandlerCalled = true;
  console.log('🔥 USER_HANDLER_START (sync)');
  
  // Use synchronous delay to see if that changes anything
  const start = Date.now();
  while (Date.now() - start < 50) {
    // Busy wait for 50ms
  }
  
  console.log('🔥 USER_HANDLER_DONE (sync)');
  console.log('🔥 About to call process.exit(0)');
  process.exit(0); // Exit cleanly after cleanup
});

console.log('Starting sleep command...');
const sleepPromise = $`sleep 3`.start();

// Send SIGINT after delay
setTimeout(() => {
  console.log('\n=== SENDING SIGINT ===');
  process.kill(process.pid, 'SIGINT');
}, 200);

try {
  await sleepPromise;
} catch (error) {
  console.log('Sleep interrupted:', error.message);
}