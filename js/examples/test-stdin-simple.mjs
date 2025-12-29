#!/usr/bin/env node

/**
 * Simple focused test for streams.stdin functionality
 */

import { $ } from '../js/src/$.mjs';

console.log('=== Testing streams.stdin simple functionality ===');

async function testStdinSimple() {
  try {
    // Test 1: Basic stdin with cat
    console.log('TEST 1: Send data to cat via stdin');
    const cmd1 = $`cat`;

    const stdin1 = cmd1.streams.stdin;
    console.log('  Process started?', cmd1.started);

    if (stdin1) {
      stdin1.write('Hello World\\n');
      stdin1.end();
    }

    const result1 = await cmd1;
    console.log('  Exit code:', result1.code);
    console.log('  Output:', JSON.stringify(result1.stdout));

    // Test 2: stdin with echo command using Node.js
    console.log('\\nTEST 2: Node.js script reading stdin');
    const cmd2 = $`node -e "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => process.exit(0));"`;

    const stdin2 = cmd2.streams.stdin;
    if (stdin2) {
      stdin2.write('Node stdin test\\n');
      stdin2.end();
    }

    const result2 = await cmd2;
    console.log('  Exit code:', result2.code);
    console.log('  Output:', JSON.stringify(result2.stdout));

    // Test 3: Test kill method on sleep
    console.log('\\nTEST 3: Kill sleep command');
    const cmd3 = $`sleep 5`;

    // Start the process
    cmd3.streams.stdout; // Access to start
    console.log('  Process started?', cmd3.started);

    // Wait a bit then kill
    setTimeout(() => {
      console.log('  Killing sleep...');
      cmd3.kill();
    }, 500);

    const result3 = await cmd3;
    console.log('  Exit code:', result3.code);

    console.log('\\n✅ All stdin tests completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testStdinSimple();
