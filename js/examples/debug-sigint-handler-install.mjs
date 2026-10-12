#!/usr/bin/env bun
// Debug script to trace SIGINT handler installation and removal

import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

function getSigintListenerCount() {
  return process.listeners('SIGINT').length;
}

function getInternalState() {
  // Access internal state for debugging
  const activeProcessRunners = eval(`
    import('../src/$.mjs').then(m => {
      // Get internal state from the module
      const moduleScope = m;
      // This is a hack to access internal variables - only for debugging
      return {
        activeProcessRunners: globalThis.__activeProcessRunners || null,
        sigintHandlerInstalled: globalThis.__sigintHandlerInstalled || null
      };
    })
  `);

  return {
    sigintHandlerCount: getSigintListenerCount(),
    activeProcessRunners,
  };
}

async function testSigintHandlerInstall() {
  console.log('=== SIGINT Handler Installation Debug ===');

  console.log('\n1. Initial state:');
  console.log('Initial SIGINT listeners:', getSigintListenerCount());

  console.log('\n2. Creating first command runner...');
  const runner1 = $`sleep 0.01`;
  console.log(
    'After creating runner1, SIGINT listeners:',
    getSigintListenerCount()
  );

  console.log('\n3. Starting first command...');
  const promise1 = runner1.start();
  console.log(
    'After starting runner1, SIGINT listeners:',
    getSigintListenerCount()
  );

  console.log('\n4. Creating second command runner while first is running...');
  const runner2 = $`sleep 0.01`;
  const promise2 = runner2.start();
  console.log(
    'After starting runner2, SIGINT listeners:',
    getSigintListenerCount()
  );

  console.log('\n5. Waiting for both commands to finish...');
  await Promise.all([promise1, promise2]);

  console.log('\n6. Final state after both commands finished:');
  console.log('Final SIGINT listeners:', getSigintListenerCount());

  console.log(
    '\n7. Testing cleanup - creating and finishing another command...'
  );
  const runner3 = $`echo "test"`;
  await runner3;
  console.log(
    'After third command finished, SIGINT listeners:',
    getSigintListenerCount()
  );
}

// Run the test
testSigintHandlerInstall().catch(console.error);
