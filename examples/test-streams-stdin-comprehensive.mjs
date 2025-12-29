#!/usr/bin/env node

/**
 * Test comprehensive streams.stdin functionality including:
 * - Sending data to stdin
 * - Using kill() method to interrupt processes
 * - Testing with commands that actually read stdin
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing streams.stdin comprehensive functionality ===');
console.log('');

async function testStreamsStdinComprehensive() {
  try {
    console.log('TEST 1: Send data via streams.stdin to cat command');

    const command1 = $`cat`;
    console.log('✓ Cat command created');

    // Access stdin stream - this should auto-start the command
    const stdin1 = command1.streams.stdin;
    console.log('✓ Accessed streams.stdin - command should be started');
    console.log('  Started?', command1.started);

    // Send some data and close stdin
    if (stdin1) {
      stdin1.write('Hello from streams.stdin!\n');
      stdin1.write('Line 2 from stdin\n');
      stdin1.write('Final line\n');
      stdin1.end(); // Close stdin to let cat finish
    }

    const result1 = await command1;
    console.log('✓ Cat command completed with exit code:', result1.code);
    console.log('✓ Output:', JSON.stringify(result1.stdout));

    console.log('');
    console.log('TEST 2: Use kill() method to interrupt ping command');

    const command2 = $`ping 8.8.8.8`;
    console.log('✓ Ping command created');

    // Access streams to start the command
    const streams2 = command2.streams;
    console.log('✓ Accessed streams - command should be started');
    console.log('  Started?', command2.started);

    // Wait for ping to start outputting
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Kill the command
    console.log('✓ Killing ping command...');
    command2.kill();

    const result2 = await command2;
    console.log('✓ Ping command terminated with exit code:', result2.code);
    console.log('✓ Output length:', result2.stdout.length);

    console.log('');
    console.log('TEST 3: Send data to grep command via stdin');

    const command3 = $`grep "hello"`;
    console.log('✓ Grep command created');

    const stdin3 = command3.streams.stdin;
    console.log('✓ Accessed streams.stdin for grep command');

    // Send data to grep
    if (stdin3) {
      stdin3.write('this is a test line\\n');
      stdin3.write('hello world\\n');
      stdin3.write('another test line\\n');
      stdin3.write('hello again\\n');
      stdin3.end();
    }

    const result3 = await command3;
    console.log('✓ Grep command completed with exit code:', result3.code);
    console.log('✓ Filtered output:', JSON.stringify(result3.stdout));

    console.log('');
    console.log('TEST 4: Test stdin with wc command');

    const command4 = $`wc -l`;
    console.log('✓ Word count command created');

    const stdin4 = command4.streams.stdin;
    if (stdin4) {
      stdin4.write('Line 1\\n');
      stdin4.write('Line 2\\n');
      stdin4.write('Line 3\\n');
      stdin4.write('Line 4\\n');
      stdin4.end();
    }

    const result4 = await command4;
    console.log('✓ Word count completed with exit code:', result4.code);
    console.log('✓ Line count result:', JSON.stringify(result4.stdout.trim()));

    console.log('');
    console.log(
      'TEST 5: Test streams.stdin availability immediately after creation'
    );

    const command5 = $`cat`;
    console.log('✓ Command5 created');
    console.log('  Started?', command5.started);

    // Check if stdin is available before auto-start
    const stdin5 = command5.streams.stdin;
    console.log('✓ Stdin available?', !!stdin5);
    console.log('  Started after accessing stdin?', command5.started);

    if (stdin5) {
      stdin5.write('Testing immediate availability\\n');
      stdin5.end();
    }

    const result5 = await command5;
    console.log('✓ Result:', JSON.stringify(result5.stdout));

    console.log('');
    console.log('✅ ALL STREAMS.STDIN COMPREHENSIVE TESTS COMPLETED!');
  } catch (error) {
    console.log('');
    console.error('❌ STREAMS.STDIN COMPREHENSIVE TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testStreamsStdinComprehensive();
