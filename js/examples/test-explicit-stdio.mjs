#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Test with explicit stdio configuration ===');

async function testExplicitStdio() {
  console.log('Test 1: Use run() with explicit stdio');

  const cmd1 = $`cat`;
  const stdin1 = cmd1.streams.stdin;

  console.log('Stdin before run:', !!stdin1);

  // Explicitly set stdio to pipe mode
  const runPromise = cmd1.run({
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  console.log('Command started?', cmd1.started);
  console.log('Stdin after start:', !!cmd1.streams.stdin);

  const actualStdin = cmd1.streams.stdin;
  if (actualStdin) {
    actualStdin.write('Hello explicit stdio\\n');
    actualStdin.end();
  }

  const result1 = await runPromise;
  console.log('Result:', result1);

  console.log('\\nTest 2: Start manually with stdio options');

  const cmd2 = $`cat`;
  cmd2.start({ mode: 'async', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });

  const stdin2 = cmd2.streams.stdin;
  console.log('Manual start stdin available?', !!stdin2);

  if (stdin2) {
    stdin2.write('Manual start test\\n');
    stdin2.end();
  }

  const result2 = await cmd2;
  console.log('Manual result:', result2);
}

testExplicitStdio().catch(console.error);
