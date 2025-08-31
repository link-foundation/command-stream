#!/usr/bin/env node

// Temporary test file for SIGINT handling - can be used for debugging user signal handlers

import { $ } from '../src/$.mjs';

let sigintReceived = false;

process.on('SIGINT', () => {
  sigintReceived = true;
  console.log('USER_SIGINT_HANDLER_CALLED');
  process.exit(42); // Custom exit code to verify user handler was called
});

console.log('Process started, waiting for SIGINT...');

// Wait for SIGINT (simulate doing some work without child processes)
setTimeout(() => {
  console.log('TIMEOUT_REACHED');
  process.exit(1); // Should not reach here in test
}, 10000);