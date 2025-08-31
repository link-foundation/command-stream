#!/usr/bin/env node

// Test sleep example for CI reliability (no network dependencies)
import { $ } from '../src/$.mjs';

console.log('STARTING_SLEEP');
process.stdout.write(''); // Flush output immediately
try {
  await $`sleep 30`; // Long enough to be interrupted, but timeout safe
  console.log('SLEEP_COMPLETED');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}