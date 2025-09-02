import { $ } from '../src/$.mjs';

console.log('=== PARENT STREAM CLOSURE TEST ===');

// Start a long-running command
const runner = $`sleep 5`;
const promise = runner.start();

// Simulate parent stream closure after a delay
setTimeout(() => {
  console.log('SIMULATING_PARENT_STREAM_CLOSURE');
  process.stdout.destroy(); // This should trigger cleanup
}, 1000);

try {
  await promise;
  console.log('COMMAND_COMPLETED');
} catch (error) {
  console.log('COMMAND_INTERRUPTED:', error.message);
}

console.log('=== TEST DONE ===');