#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Test stdin access after process starts ===');

async function testStdinAfterStart() {
  const cmd = $`cat`;

  // First, start the process explicitly
  cmd.start({ mode: 'async', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });

  // Wait a moment for the process to actually start
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log('Process started?', cmd.started);
  console.log('Child exists?', !!cmd.child);
  console.log('Child stdin exists?', !!(cmd.child && cmd.child.stdin));

  // Now try to access stdin
  const stdin = cmd.streams.stdin;
  console.log('Stdin from streams?', !!stdin);

  if (stdin) {
    console.log('Writing to stdin...');
    stdin.write('Hello after start!\\n');
    stdin.end();
  } else {
    console.log('No stdin available, ending without input');
    // End the process some other way
    setTimeout(() => cmd.kill(), 100);
  }

  const result = await cmd;
  console.log('Final result stdout:', JSON.stringify(result.stdout));
  console.log('Exit code:', result.code);
}

testStdinAfterStart().catch(console.error);
