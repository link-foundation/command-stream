#!/usr/bin/env node
// Test SIGINT forwarding to child processes
// This runs in a subprocess to avoid killing the test runner

import { $ } from '../js/src/$.mjs';

process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('TEST: Starting SIGINT forwarding test');

// Test that SIGINT is forwarded to child processes
console.log('TEST: Starting long-running command');
const runner = $`sleep 30`;
const promise = runner.start();

// Set up a handler to catch SIGINT but don't let it kill the process
let sigintReceived = false;
process.on('SIGINT', () => {
  console.log('RESULT: parent_received_sigint=true');
  sigintReceived = true;
  // Don't exit - we want to continue the test
});

// Wait a bit for command to start
await new Promise((resolve) => setTimeout(resolve, 100));

// Send SIGINT to ourselves
console.log('TEST: Sending SIGINT');
process.kill(process.pid, 'SIGINT');

// Wait a bit for signal handling
await new Promise((resolve) => setTimeout(resolve, 200));

// Check if process was killed
let exitCode = null;
try {
  // Try to wait for the promise with a timeout
  await Promise.race([
    promise.then((result) => {
      exitCode = result.code;
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 500)
    ),
  ]);
} catch (e) {
  if (e.message === 'timeout') {
    console.log('RESULT: command_still_running=true');
  } else {
    console.log(`RESULT: command_exit_code=${exitCode ?? 'error'}`);
  }
}

console.log(`RESULT: sigint_received=${sigintReceived}`);

// Clean up
runner.kill();

console.log('TEST: Complete');
process.exit(0);
