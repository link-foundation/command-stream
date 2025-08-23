#!/usr/bin/env node

import { $ } from './$.mjs';

console.log('=== Running top command with ANSI colors preserved (default behavior) ===');

// Run top for 3 seconds then kill it
const proc = $`top -l 1`;

// Show the output as it streams
proc.on('stdout', (chunk) => {
  process.stdout.write(chunk);
});

proc.on('stderr', (chunk) => {
  process.stderr.write(chunk);
});

proc.on('end', (result) => {
  console.log('\n=== Command completed ===');
  console.log(`Exit code: ${result.code}`);
});

// Execute the command
await proc;