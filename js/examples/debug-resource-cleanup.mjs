#!/usr/bin/env bun
// Debug script to test resource cleanup behavior

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

// Function to access internal state for debugging
function getInternalDebugInfo() {
  try {
    // This is a hack to access module internals for debugging
    // We'll try to get the activeProcessRunners set
    const moduleText = Bun.file(import.meta.resolve('../src/$.mjs')).text();

    return {
      sigintListeners: process.listeners('SIGINT').length,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return {
      sigintListeners: process.listeners('SIGINT').length,
      timestamp: new Date().toISOString(),
      error: e.message,
    };
  }
}

async function testResourceCleanup() {
  console.log('=== Resource Cleanup Debug ===');

  console.log('\n1. Initial state:', getInternalDebugInfo());

  console.log('\n2. Creating and running multiple commands sequentially...');

  // Test 1: Single command
  console.log('\nTest 1: Single command');
  console.log('Before:', getInternalDebugInfo());
  const result1 = await $`echo "test1"`;
  console.log('After single command:', getInternalDebugInfo());
  console.log('Result:', result1.stdout);

  // Test 2: Multiple concurrent commands
  console.log('\nTest 2: Multiple concurrent commands');
  console.log('Before:', getInternalDebugInfo());

  const runners = [$`sleep 0.05`, $`sleep 0.05`, $`sleep 0.05`];

  const promises = runners.map((r) => r.start());
  console.log('During concurrent execution:', getInternalDebugInfo());

  await Promise.all(promises);
  console.log('After concurrent commands:', getInternalDebugInfo());

  // Test 3: Virtual commands (built-in commands)
  console.log('\nTest 3: Virtual commands');
  console.log('Before:', getInternalDebugInfo());

  const virtualResult = await $`ls /tmp`;
  console.log('After virtual command:', getInternalDebugInfo());
  console.log('Virtual result length:', virtualResult.stdout.length);

  // Test 4: Mixed real and virtual commands
  console.log('\nTest 4: Mixed commands');
  console.log('Before:', getInternalDebugInfo());

  const mixedPromises = [
    $`echo "real1"`.start(),
    $`pwd`.start(),
    $`echo "real2"`.start(),
  ];

  console.log('During mixed execution:', getInternalDebugInfo());
  const mixedResults = await Promise.all(mixedPromises);
  console.log('After mixed commands:', getInternalDebugInfo());

  console.log('\n5. Final cleanup verification');
  // Give a small delay for any async cleanup
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log('Final state:', getInternalDebugInfo());
}

testResourceCleanup().catch(console.error);
