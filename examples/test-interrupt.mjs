#!/usr/bin/env node

// Automated test for interruption handling

import { $ } from '../js/src/$.mjs';

async function test() {
  console.log('Testing interruption of virtual sleep command...');

  // Start a long sleep
  const runner = $`sleep 10`;
  const promise = runner.start();

  // Kill it after 500ms
  setTimeout(() => {
    console.log('Sending kill signal...');
    runner.kill();
  }, 500);

  // Wait for result
  const result = await promise;

  console.log('Result:', {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  if (result.code === 143) {
    console.log(
      '✓ SUCCESS: Virtual command was properly interrupted with SIGTERM exit code'
    );
    process.exit(0);
  } else {
    console.log('✗ FAIL: Unexpected exit code:', result.code);
    process.exit(1);
  }
}

test().catch(console.error);
