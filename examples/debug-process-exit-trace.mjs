#!/usr/bin/env bun
// Debug script to trace process.exit calls

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

// Monkey patch process.exit to trace calls
const originalExit = process.exit;
process.exit = function(code) {
  console.log(`🚨 process.exit(${code}) called`);
  console.log('Stack trace:', new Error().stack);
  return originalExit.call(this, code);
};

let cleanupDone = false;

// User handler
process.on('SIGINT', async () => {
  console.log('CHILD_CLEANUP_START');
  await new Promise(resolve => setTimeout(resolve, 100));
  cleanupDone = true;
  console.log('CHILD_CLEANUP_DONE - calling process.exit(0)');
  process.exit(0);
});

console.log('CHILD_READY');

try {
  const sleepPromise = $`sleep 5`.start();
  
  setTimeout(() => {
    console.log('Sending SIGINT...');
    process.kill(process.pid, 'SIGINT');
  }, 500);
  
  await sleepPromise;
} catch (error) {
  console.log('SLEEP_INTERRUPTED:', error.message);
}