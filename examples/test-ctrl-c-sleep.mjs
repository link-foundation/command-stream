#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing CTRL+C with sleep command');
console.log('Press CTRL+C to interrupt the sleep...');
console.log('---');

// Set up SIGINT handler to see if parent process receives it
let signalReceived = false;
process.on('SIGINT', () => {
  console.log('\n[Parent process received SIGINT]');
  signalReceived = true;
});

try {
  console.log('Starting 30 second sleep...');
  const result = await $`sleep 30`;
  console.log('Sleep completed normally:', result);
} catch (error) {
  console.log('\nCommand was interrupted or failed');
  console.log('Error:', error.message);
  console.log('Exit code:', error.code);
  console.log('Parent received SIGINT:', signalReceived);
}

// Give a moment for any pending signals
setTimeout(() => {
  console.log('Final state - Parent received SIGINT:', signalReceived);
  process.exit(signalReceived ? 130 : 0);
}, 100);