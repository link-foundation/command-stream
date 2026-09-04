#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== SIGINT Listeners Debug ===');

function logSigintListeners(label) {
  const listeners = process.listeners('SIGINT');
  console.log(`\n--- ${label} ---`);
  console.log('Total SIGINT listeners:', listeners.length);

  listeners.forEach((listener, i) => {
    const str = listener.toString();
    const isCommandStream =
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren');
    console.log(
      `Listener ${i}: ${isCommandStream ? 'COMMAND-STREAM' : 'OTHER'}`
    );
    if (isCommandStream) {
      console.log(`  Source preview: ${str.substring(0, 200)}...`);
    }
  });
}

logSigintListeners('Initial state');

console.log('\nRunning a simple command...');
const cmd1 = $`echo "test1"`;
await cmd1;

logSigintListeners('After first command');

console.log('\nRunning another command...');
const cmd2 = $`echo "test2"`;
await cmd2;

logSigintListeners('After second command');

console.log('\nRunning a concurrent command...');
const cmd3 = $`sleep 0.1`;
const cmd4 = $`echo "test3"`;
await Promise.all([cmd3, cmd4]);

logSigintListeners('After concurrent commands');

console.log('\nTest completed.');
