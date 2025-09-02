#!/usr/bin/env node

// Test sleep example for CI reliability (no network dependencies)
import { $ } from '../src/$.mjs';

console.error('[test-sleep.mjs] Process started, PID:', process.pid);
console.error('[test-sleep.mjs] Is TTY:', process.stdout.isTTY);
console.error('[test-sleep.mjs] Node version:', process.version);

console.log('STARTING_SLEEP');
console.error('[test-sleep.mjs] Wrote STARTING_SLEEP to stdout');

// Ensure stdout is flushed immediately for CI environments
await new Promise(resolve => {
  if (process.stdout.isTTY === false) {
    console.error('[test-sleep.mjs] Non-TTY environment detected, forcing flush');
    // Force flush in non-TTY environments (CI)
    process.stdout.write('', () => {
      console.error('[test-sleep.mjs] Stdout flush completed');
      resolve();
    });
  } else {
    console.error('[test-sleep.mjs] TTY environment, no flush needed');
    resolve();
  }
});

console.error('[test-sleep.mjs] About to run sleep command');
try {
  const result = await $`sleep 30`; // Long enough to be interrupted, but timeout safe
  console.log('SLEEP_COMPLETED');
  console.error('[test-sleep.mjs] Sleep completed with code:', result.code);
} catch (error) {
  console.error('[test-sleep.mjs] Sleep interrupted:', error.message, 'code:', error.code);
  process.exit(error.code || 1);
}