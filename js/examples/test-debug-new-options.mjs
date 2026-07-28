#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function debug() {
  console.log('=== Debugging how new options work ===');

  // First let's see what happens with await directly
  console.log('\n1. Direct await $`echo test`:');
  const result1 = await $`echo "direct await"`;
  console.log('Result stdout:', JSON.stringify(result1.stdout));

  // Now let's check the runner before starting
  console.log('\n2. Inspecting runner before start:');
  const runner = $`echo "before start"`;
  console.log('Runner options before start:', runner.options);
  console.log(
    'Runner outChunks before start:',
    runner.outChunks ? 'array' : 'null'
  );

  // Now call start with capture: false
  console.log('\n3. Calling start with capture: false:');
  const result2 = await runner.start({ capture: false });
  console.log('Runner options after start:', runner.options);
  console.log('Result stdout:', JSON.stringify(result2.stdout));

  // Test with .run() method
  console.log('\n4. Testing .run() method:');
  const result3 = await $`echo "run method test"`.run({
    capture: false,
    mirror: false,
  });
  console.log('Result stdout:', JSON.stringify(result3.stdout));
  console.log('Result code:', result3.code);

  // Test runner state inspection
  console.log('\n5. Runner state inspection:');
  const runner2 = $`echo "state test"`;
  console.log('Initial state:');
  console.log('  started:', runner2.started);
  console.log('  options.capture:', runner2.options.capture);
  console.log('  outChunks:', runner2.outChunks ? 'array' : 'null');

  console.log('\nCalling start with capture: false...');
  const result4 = await runner2.start({ capture: false });

  console.log('\nAfter start:');
  console.log('  started:', runner2.started);
  console.log('  options.capture:', runner2.options.capture);
  console.log('  outChunks:', runner2.outChunks);
  console.log('  result.stdout:', JSON.stringify(result4.stdout));
}

debug().catch(console.error);
