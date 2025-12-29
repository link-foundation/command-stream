#!/usr/bin/env bun
// Test the forceCleanupAll function

import { $, forceCleanupAll } from '../js/src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testForceCleanup() {
  console.log('=== Force Cleanup Test ===');

  console.log('\n1. Initial state:');
  console.log('SIGINT handlers:', process.listeners('SIGINT').length);

  console.log('\n2. Create some runners to install handlers...');
  const runner1 = $`sleep 0.1`;
  const runner2 = $`echo "test"`;

  console.log('After creating runners:', process.listeners('SIGINT').length);

  console.log('\n3. Start them to activate handlers...');
  const promise1 = runner1.start();
  const promise2 = runner2.start();

  console.log('After starting:', process.listeners('SIGINT').length);

  console.log('\n4. Test forceCleanupAll...');
  forceCleanupAll();
  console.log('After forceCleanupAll:', process.listeners('SIGINT').length);

  console.log('\n5. Try to create a new runner...');
  const runner3 = $`echo "after cleanup"`;
  console.log('After creating new runner:', process.listeners('SIGINT').length);

  console.log('\n6. Cleanup again...');
  forceCleanupAll();
  console.log('Final state:', process.listeners('SIGINT').length);

  // Clean exit
  try {
    await Promise.allSettled([promise1, promise2]);
  } catch (e) {
    // Ignore errors from killed processes
  }
}

testForceCleanup().catch(console.error);
