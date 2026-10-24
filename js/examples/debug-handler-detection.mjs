#!/usr/bin/env bun
// Debug script to test the exact pattern matching used by the tests

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

function getInternalState() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren')
    );
  });

  return {
    sigintHandlerCount: commandStreamListeners.length,
    totalSigintListeners: sigintListeners.length,
    allListeners: sigintListeners.map((l) => ({
      length: l.toString().length,
      contains: {
        activeProcessRunners: l.toString().includes('activeProcessRunners'),
        ProcessRunner: l.toString().includes('ProcessRunner'),
        activeChildren: l.toString().includes('activeChildren'),
      },
    })),
  };
}

async function testHandlerDetection() {
  console.log('=== Handler Detection Debug ===');

  console.log('\n1. Initial state:');
  console.log(JSON.stringify(getInternalState(), null, 2));

  console.log('\n2. Creating runner...');
  const runner = $`sleep 0.1`;
  console.log(
    'After creating runner:',
    JSON.stringify(getInternalState(), null, 2)
  );

  console.log('\n3. Starting runner...');
  const promise = runner.start();
  console.log(
    'Immediately after start():',
    JSON.stringify(getInternalState(), null, 2)
  );

  // Small delay to let any async operations complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log('After 10ms delay:', JSON.stringify(getInternalState(), null, 2));

  console.log('\n4. Waiting for completion...');
  await promise;

  console.log('\n5. Final state:');
  console.log(JSON.stringify(getInternalState(), null, 2));
}

testHandlerDetection().catch(console.error);
