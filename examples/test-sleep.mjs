#!/usr/bin/env node

// Test sleep example for CI reliability (no network dependencies)
import { $ } from '../src/$.mjs';

console.log('STARTING_SLEEP');
// Ensure stdout is flushed immediately for CI environments
if (process.stdout.isTTY === false) {
  process.stdout.write('', () => {});
}
try {
  await $`sleep 30`; // Long enough to be interrupted, but timeout safe
  console.log('SLEEP_COMPLETED');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}