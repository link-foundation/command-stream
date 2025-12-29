#!/usr/bin/env node

/**
 * Test to verify that streams.stdin can be used to send CTRL+C to interrupt commands
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing streams.stdin CTRL+C functionality ===');
console.log('');

async function testStreamsStdinCtrlC() {
  try {
    console.log('TEST 1: Send CTRL+C via streams.stdin to ping command');

    const command = $`ping 8.8.8.8`;
    console.log('✓ Command created');

    // Access stdin stream - this should auto-start the command
    const stdin = command.streams.stdin;
    console.log('✓ Accessed streams.stdin - command should be started');
    console.log('  Started?', command.started);

    // Wait a moment for ping to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Send CTRL+C (ASCII code 3)
    console.log('✓ Sending CTRL+C via stdin...');
    if (stdin) {
      stdin.write('\x03'); // CTRL+C
      stdin.end();
    }

    // Wait for the command to complete
    const result = await command;
    console.log('✓ Command completed with exit code:', result.code);
    console.log('✓ Stdout length:', result.stdout.length);
    console.log(
      '✓ First 200 chars of stdout:',
      JSON.stringify(result.stdout.slice(0, 200))
    );

    console.log('');
    console.log('TEST 2: Test with a different long-running command');

    const command2 = $`sleep 10`;
    console.log('✓ Sleep command created');

    const stdin2 = command2.streams.stdin;
    console.log('✓ Accessed streams.stdin for sleep command');

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send CTRL+C
    console.log('✓ Sending CTRL+C to sleep command...');
    if (stdin2) {
      stdin2.write('\x03');
      stdin2.end();
    }

    const result2 = await command2;
    console.log('✓ Sleep command completed with exit code:', result2.code);

    console.log('');
    console.log('TEST 3: Test stdin with echo command');

    const command3 = $`cat`;
    console.log('✓ Cat command created');

    const stdin3 = command3.streams.stdin;
    console.log('✓ Accessed streams.stdin for cat command');

    // Send some data first, then CTRL+C
    if (stdin3) {
      stdin3.write('Hello from stdin!\n');
      await new Promise((resolve) => setTimeout(resolve, 100));
      stdin3.write('\x03'); // CTRL+C
      stdin3.end();
    }

    const result3 = await command3;
    console.log('✓ Cat command completed with exit code:', result3.code);
    console.log('✓ Output:', JSON.stringify(result3.stdout));

    console.log('');
    console.log('✅ ALL STREAMS.STDIN CTRL+C TESTS COMPLETED!');
  } catch (error) {
    console.log('');
    console.error('❌ STREAMS.STDIN CTRL+C TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testStreamsStdinCtrlC();
