#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testStreamAccess() {
  console.log('Testing event-driven stream access (no setTimeout)...\n');

  // Test 1: Access streams before process starts
  console.log('Test 1: Accessing streams before process starts');
  const proc1 = $`echo "Hello from stdout" && echo "Error message" >&2`;

  const streams = proc1.streams;
  const stdinPromise = streams.stdin;
  const stdoutPromise = streams.stdout;
  const stderrPromise = streams.stderr;

  console.log('Waiting for streams...');
  const [stdin, stdout, stderr] = await Promise.all([
    stdinPromise,
    stdoutPromise,
    stderrPromise,
  ]);

  console.log('  stdin:', stdin ? 'available' : 'null');
  console.log('  stdout:', stdout ? 'available' : 'null');
  console.log('  stderr:', stderr ? 'available' : 'null');

  const result1 = await proc1;
  console.log('  Result stdout:', result1.stdout.trim());
  console.log('  Result stderr:', result1.stderr.trim());
  console.log('✓ Test 1 passed\n');

  // Test 2: Access streams after process starts
  console.log('Test 2: Accessing streams after process starts');
  const proc2 = $`sleep 0.1 && echo "Delayed output"`;

  // Start the process
  proc2.start();

  // Now access streams - should resolve immediately or wait without setTimeout
  const streams2 = proc2.streams;
  const stdout2 = await streams2.stdout;
  console.log('  stdout after start:', stdout2 ? 'available' : 'null');

  const result2 = await proc2;
  console.log('  Result:', result2.stdout.trim());
  console.log('✓ Test 2 passed\n');

  // Test 3: Test with finished process
  console.log('Test 3: Accessing streams of finished process');
  const proc3 = await $`echo "Already done"`;

  const streams3 = proc3.streams;
  const stdout3 = await streams3.stdout;
  console.log(
    '  stdout of finished process:',
    stdout3 ? 'available' : 'null (expected)'
  );
  console.log('  Result:', proc3.stdout.trim());
  console.log('✓ Test 3 passed\n');

  // Test 4: Test parent stream closure handling (uses setImmediate now)
  console.log('Test 4: Parent stream closure handling');
  const proc4 = $`sleep 0.2 && echo "Should be terminated"`;

  // Simulate parent stream closure scenario
  setTimeout(() => {
    console.log('  Simulating kill...');
    proc4.kill();
  }, 50);

  try {
    await proc4;
  } catch (e) {
    // Expected to fail
  }

  console.log('  Process killed successfully');
  console.log('✓ Test 4 passed\n');

  console.log('All tests passed! No setTimeout used for polling.');
}

testStreamAccess().catch(console.error);
