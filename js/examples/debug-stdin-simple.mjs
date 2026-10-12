#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Debug: Simple stdin test ===');

async function debugStdinSimple() {
  console.log('Testing cat with explicit options...');

  const cmd = $`cat`;
  const stdin = cmd.streams.stdin;

  console.log('Stdin available?', !!stdin);
  console.log('Command started?', cmd.started);

  if (stdin) {
    console.log('Writing to stdin...');
    stdin.write('test data\\n');
    console.log('Ending stdin...');
    stdin.end();
  }

  console.log('Waiting for result...');
  const result = await cmd;
  console.log('Result:', result);
}

debugStdinSimple().catch(console.error);
