#!/usr/bin/env bun
// Debug script to test SIGINT forwarding behavior

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testSigintForwarding() {
  console.log('=== SIGINT Forwarding Debug ===');

  console.log(
    '\n1. Initial SIGINT listeners:',
    process.listeners('SIGINT').length
  );

  console.log('\n2. Starting a long-running command...');
  const runner = $`sleep 5`;
  const promise = runner.start();

  console.log(
    'SIGINT listeners after starting:',
    process.listeners('SIGINT').length
  );

  // Send SIGINT after a short delay
  setTimeout(() => {
    console.log('\n3. Sending SIGINT to parent process...');
    console.log(
      'Active listeners before SIGINT:',
      process.listeners('SIGINT').length
    );
    process.kill(process.pid, 'SIGINT');
  }, 100);

  try {
    const result = await promise;
    console.log('\n4. Command completed with result:', result);
  } catch (error) {
    console.log('\n4. Command failed with error:', error.message);
    console.log('Exit code:', error.code);
  }

  console.log('\nFinal SIGINT listeners:', process.listeners('SIGINT').length);
}

// Install a test SIGINT handler to see if it gets called
let parentSigintReceived = false;
const testHandler = () => {
  parentSigintReceived = true;
  console.log('TEST: Parent SIGINT handler called');
};

process.on('SIGINT', testHandler);

testSigintForwarding()
  .then(() => {
    console.log('TEST: Parent received SIGINT:', parentSigintReceived);
    process.removeListener('SIGINT', testHandler);
  })
  .catch(console.error);
