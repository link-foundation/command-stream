#!/usr/bin/env bun
// Debug script to test SIGINT handler interaction

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

// Simulate the child process scenario from the failing test
let cleanupDone = false;

// Add user SIGINT handler FIRST (like the test does)
process.on('SIGINT', async () => {
  console.log('USER_SIGINT_HANDLER_START');
  // Simulate cleanup work
  await new Promise((resolve) => setTimeout(resolve, 50));
  cleanupDone = true;
  console.log('USER_SIGINT_HANDLER_DONE');
  process.exit(0); // Exit cleanly after cleanup
});

console.log('CHILD_READY');
console.log('Initial SIGINT handlers:', process.listeners('SIGINT').length);

// Now start a command that will cause the command-stream SIGINT handler to be installed
console.log('Starting sleep command...');
const sleepPromise = $`sleep 2`.start();

console.log(
  'After starting command, SIGINT handlers:',
  process.listeners('SIGINT').length
);

// Simulate SIGINT being sent after a short delay
setTimeout(() => {
  console.log('Sending SIGINT to self...');
  process.kill(process.pid, 'SIGINT');
}, 100);

try {
  await sleepPromise;
} catch (error) {
  console.log('Sleep interrupted:', error.message);
}
