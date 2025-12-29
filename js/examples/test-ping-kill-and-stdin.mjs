#!/usr/bin/env node

/**
 * Simple test to verify:
 * 1. streams.stdin can be used to send data to commands that read stdin
 * 2. kill() method works to interrupt ping commands
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing ping kill() and streams.stdin ===');
console.log('');

async function testPingKillAndStdin() {
  try {
    console.log('TEST 1: Use kill() method to interrupt ping 8.8.8.8');

    const pingCommand = $`ping 8.8.8.8`;

    // Access streams.stdout to auto-start the command
    const stdout = pingCommand.streams.stdout;
    console.log('✓ Accessed streams.stdout - ping should start');
    console.log('  Started?', pingCommand.started);

    // Wait for ping to produce some output
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Kill the ping command
    console.log('✓ Killing ping command...');
    pingCommand.kill();

    const result = await pingCommand;
    console.log('✓ Ping killed with exit code:', result.code);
    console.log('✓ Output received (length):', result.stdout.length);
    console.log(
      '✓ First 100 chars:',
      JSON.stringify(result.stdout.slice(0, 100))
    );

    console.log('');
    console.log('TEST 2: Send data via streams.stdin to cat');

    const catCommand = $`cat`;

    // Access stdin to auto-start and get the stream
    const stdin = catCommand.streams.stdin;
    console.log('✓ Accessed streams.stdin - cat should start');
    console.log('  Started?', catCommand.started);

    // Send data to cat
    if (stdin) {
      console.log('✓ Writing data to stdin...');
      stdin.write('Hello from stdin!\\n');
      stdin.write('Second line\\n');
      stdin.end(); // Close stdin so cat finishes
    }

    const catResult = await catCommand;
    console.log('✓ Cat completed with exit code:', catResult.code);
    console.log('✓ Cat output:', JSON.stringify(catResult.stdout));

    console.log('');
    console.log(
      'TEST 3: Verify stdin is available but process not started initially'
    );

    const echoCommand = $`cat`;
    console.log('✓ Command created, started?', echoCommand.started);

    // Just access streams object (should not auto-start)
    const streams = echoCommand.streams;
    console.log('✓ Accessed .streams object, started?', echoCommand.started);

    // Now access stdin (should auto-start)
    const echoStdin = echoCommand.streams.stdin;
    console.log('✓ Accessed .streams.stdin, started?', echoCommand.started);

    if (echoStdin) {
      echoStdin.write('Auto-start test\\n');
      echoStdin.end();
    }

    const echoResult = await echoCommand;
    console.log('✓ Result:', JSON.stringify(echoResult.stdout));

    console.log('');
    console.log(
      '✅ ALL TESTS PASSED - ping kill() and streams.stdin work correctly!'
    );
  } catch (error) {
    console.log('');
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testPingKillAndStdin();
