#!/usr/bin/env node

// Manual test for CTRL+C handling
// Run this script and press CTRL+C to test signal propagation

import { $ } from '../src/$.mjs';

console.log('=== Manual CTRL+C Test ===\n');
console.log('This script will run ping continuously.');
console.log('Press CTRL+C to interrupt and see if it properly terminates.\n');
console.log('Starting ping to 8.8.8.8...');
console.log('----------------------------------------\n');

// Track if we received SIGINT
let parentGotSigint = false;
process.on('SIGINT', () => {
  console.log('\n[PARENT] Received SIGINT signal');
  parentGotSigint = true;
});

// Clean exit handler
process.on('exit', (code) => {
  console.log(`\n[PARENT] Exiting with code: ${code}`);
  console.log(`Parent received SIGINT: ${parentGotSigint}`);
});

try {
  // Run ping with default settings (stdin: 'inherit')
  const result = await $`ping 8.8.8.8`;
  console.log('\nPing completed normally (unexpected)');
} catch (error) {
  console.log('\n----------------------------------------');
  console.log('Command was interrupted!');
  console.log(`Exit code: ${error.code}`);
  console.log(`Error message: ${error.message}`);
  
  if (error.code === 130 || error.code === -2 || error.code === 2) {
    console.log('✓ SUCCESS: Received expected SIGINT exit code');
  } else {
    console.log(`⚠ WARNING: Unexpected exit code ${error.code}`);
  }
}