#!/usr/bin/env node

// Simple test script for CI without ES module dependencies
console.log('STARTING_SLEEP');
console.error('[simple-test-sleep] Process started, PID:', process.pid);
console.error('[simple-test-sleep] Node version:', process.version);

// Force flush stdout in non-TTY environments
if (process.stdout.isTTY === false) {
  process.stdout.write('', () => {
    console.error('[simple-test-sleep] Stdout flushed');
  });
}

// Set up SIGINT handler
process.on('SIGINT', () => {
  console.error('[simple-test-sleep] Received SIGINT');
  process.exit(130);
});

// Simple sleep using setTimeout
console.error('[simple-test-sleep] Starting 30 second sleep');
setTimeout(() => {
  console.log('SLEEP_COMPLETED');
  console.error('[simple-test-sleep] Sleep completed');
  process.exit(0);
}, 30000);

// Keep process alive
process.stdin.resume();
