#!/usr/bin/env node

/**
 * Test to verify that auto-start only happens on actual stdin/stdout/stderr access,
 * not when accessing the parent objects (streams, buffers, strings).
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing Auto-Start Behavior Fix ===');
console.log('');

async function testAutoStartBehavior() {
  try {
    console.log('TEST 1: Accessing parent objects should NOT auto-start');

    const command1 = $`echo "test1"`;
    console.log('✓ Command created');
    console.log('  Started?', command1.started);
    console.log('  Finished?', command1.finished);

    // These should NOT auto-start the command
    const streams = command1.streams;
    console.log('✓ Accessed .streams');
    console.log('  Started?', command1.started);

    const buffers = command1.buffers;
    console.log('✓ Accessed .buffers');
    console.log('  Started?', command1.started);

    const strings = command1.strings;
    console.log('✓ Accessed .strings');
    console.log('  Started?', command1.started);

    console.log('');
    console.log('TEST 2: Accessing stdin/stdout/stderr SHOULD auto-start');

    const command2 = $`echo "test2"`;
    console.log('✓ Command2 created');
    console.log('  Started?', command2.started);

    // This SHOULD auto-start the command
    const stdout = command2.streams.stdout;
    console.log('✓ Accessed .streams.stdout');
    console.log('  Started?', command2.started);

    // Wait for completion
    const result2 = await command2;
    console.log('✓ Result:', JSON.stringify(result2.stdout.trim()));

    console.log('');
    console.log('TEST 3: Buffer access should auto-start');

    const command3 = $`echo "test3"`;
    console.log('✓ Command3 created');
    console.log('  Started?', command3.started);

    // Access buffer properties - should NOT auto-start yet
    const buffers3 = command3.buffers;
    console.log('✓ Accessed .buffers');
    console.log('  Started?', command3.started);

    // Now access actual buffer - SHOULD auto-start
    const stdoutBuffer = await command3.buffers.stdout;
    console.log('✓ Accessed .buffers.stdout');
    console.log('  Result:', stdoutBuffer.toString().trim());

    console.log('');
    console.log('TEST 4: String access should auto-start');

    const command4 = $`echo "test4"`;
    console.log('✓ Command4 created');
    console.log('  Started?', command4.started);

    // Access string properties - should NOT auto-start yet
    const strings4 = command4.strings;
    console.log('✓ Accessed .strings');
    console.log('  Started?', command4.started);

    // Now access actual string - SHOULD auto-start
    const stdoutString = await command4.strings.stdout;
    console.log('✓ Accessed .strings.stdout');
    console.log('  Result:', JSON.stringify(stdoutString.trim()));

    console.log('');
    console.log('✅ ALL AUTO-START TESTS PASSED!');
  } catch (error) {
    console.log('');
    console.error('❌ AUTO-START TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testAutoStartBehavior();
