#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function debugStdin() {
  console.log('🐛 Debugging stdin streams');

  const catCmd = $`cat`;
  console.log('Created cat command');

  console.log('Awaiting stdin...');
  const stdin = await catCmd.streams.stdin;

  console.log('stdin type:', typeof stdin);
  console.log('stdin constructor:', stdin ? stdin.constructor.name : 'null');
  console.log('has write method:', !!(stdin && stdin.write));
  console.log('is writable:', stdin ? stdin.writable : 'N/A');
  console.log('is destroyed:', stdin ? stdin.destroyed : 'N/A');

  if (stdin) {
    console.log('stdin keys:', Object.keys(stdin));
  }

  // Kill the process to clean up
  catCmd.kill();
}

debugStdin();
