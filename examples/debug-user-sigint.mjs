#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

let sigintReceived = false;

process.on('SIGINT', () => {
  sigintReceived = true;
  console.log('USER_SIGINT_HANDLER_CALLED');
  process.exit(42); // Custom exit code to verify user handler was called
});

console.log('Process started, waiting for SIGINT...');

// Wait for SIGINT (simulate doing some work without child processes)
setTimeout(() => {
  console.log('TIMEOUT_REACHED - no SIGINT received');
  process.exit(1); // Should not reach here in test
}, 5000);
