#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Simple async streams test ===');

async function simpleAsyncTest() {
  try {
    console.log('Test 1: bc calculator with await');

    const bcCmd = $`bc -l`;
    console.log('Awaiting stdin...');

    const stdin = await bcCmd.streams.stdin;
    console.log('Stdin available:', !!stdin);

    if (stdin) {
      console.log('Writing to stdin...');
      stdin.write('2 + 3\\n');
      stdin.write('quit\\n');
    } else {
      console.log('No stdin, killing process');
      bcCmd.kill();
    }

    const result = await bcCmd;
    console.log('Result:', JSON.stringify(result.stdout));
    console.log('Exit code:', result.code);

    console.log('\\nTest 2: cat with await');

    const catCmd = $`cat`;
    const catStdin = await catCmd.streams.stdin;
    console.log('Cat stdin available:', !!catStdin);

    if (catStdin) {
      catStdin.write('Hello cat!\\n');
      catStdin.end();
    }

    const catResult = await catCmd;
    console.log('Cat result:', JSON.stringify(catResult.stdout));
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

simpleAsyncTest();
