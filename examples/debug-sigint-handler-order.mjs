#!/usr/bin/env bun
// Debug script to test SIGINT handler order and execution

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

let userHandlerCalled = false;
let userHandlerFinished = false;

// Add user SIGINT handler FIRST
process.on('SIGINT', async () => {
  userHandlerCalled = true;
  console.log('🔥 USER_HANDLER_START');
  console.log('🔥 Current SIGINT handlers when user handler runs:', process.listeners('SIGINT').length);
  
  // Simulate cleanup work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  userHandlerFinished = true;
  console.log('🔥 USER_HANDLER_DONE');
  console.log('🔥 About to call process.exit(0)');
  process.exit(0); // Exit cleanly after cleanup
});

console.log('CHILD_READY');
console.log('Initial SIGINT handlers:', process.listeners('SIGINT').length);

// Show all handlers
const initialHandlers = process.listeners('SIGINT');
initialHandlers.forEach((handler, i) => {
  console.log(`Handler ${i}:`, handler.toString().substring(0, 100) + '...');
});

// Start a command to install command-stream handler
console.log('Starting sleep command...');
const sleepPromise = $`sleep 3`.start();

console.log('After starting command, SIGINT handlers:', process.listeners('SIGINT').length);

// Show all handlers again
const afterHandlers = process.listeners('SIGINT');
afterHandlers.forEach((handler, i) => {
  const str = handler.toString();
  const isCommandStream = str.includes('activeProcessRunners') || str.includes('ProcessRunner');
  console.log(`Handler ${i} (${isCommandStream ? 'COMMAND-STREAM' : 'USER'}):`, str.substring(0, 80) + '...');
});

// Send SIGINT after delay
setTimeout(() => {
  console.log('\n=== SENDING SIGINT ===');
  console.log('User handler called before SIGINT?', userHandlerCalled);
  console.log('Handlers at time of SIGINT:', process.listeners('SIGINT').length);
  process.kill(process.pid, 'SIGINT');
}, 200);

try {
  await sleepPromise;
} catch (error) {
  console.log('Sleep interrupted:', error.message);
}

// This should never be reached if handlers work correctly
console.log('This should not print - handlers should have called process.exit()');
setTimeout(() => {
  console.log('Final state:');
  console.log('User handler called:', userHandlerCalled);
  console.log('User handler finished:', userHandlerFinished);
}, 500);