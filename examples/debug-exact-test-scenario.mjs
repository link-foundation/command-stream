#!/usr/bin/env bun
// Exact replica of the failing test scenario

import { $ } from '../js/src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

let cleanupDone = false;

// Exact same handler as in the test
process.on('SIGINT', async () => {
  console.log('CHILD_CLEANUP_START');
  // Simulate cleanup work
  await new Promise((resolve) => setTimeout(resolve, 100));
  cleanupDone = true;
  console.log('CHILD_CLEANUP_DONE');
  process.exit(0); // Exit cleanly after cleanup
});

console.log('CHILD_READY');

// Run a command that will receive SIGINT forwarding
try {
  const sleepPromise = $`sleep 5`.start();

  // Send SIGINT to ourselves after a short delay (simulating the test)
  setTimeout(() => {
    console.log('Sending SIGINT...');
    process.kill(process.pid, 'SIGINT');
  }, 500);

  await sleepPromise;
} catch (error) {
  console.log('SLEEP_INTERRUPTED');
  console.log('Error details:', {
    message: error.message,
    code: error.code,
    constructor: error.constructor.name,
  });
}

// This should not be reached
console.log('End of script reached (should not happen)');
