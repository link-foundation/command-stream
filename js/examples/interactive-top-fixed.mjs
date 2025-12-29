#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Fixed Interactive top command ===');
console.log('This version properly handles:');
console.log('- Interactive keyboard input (q to quit)');
console.log('- ANSI colors and formatting');
console.log('- Terminal control sequences');
console.log('- Proper stdin/stdout forwarding');
console.log('\nStarting top... Press q to quit when ready.\n');

// Use direct spawn with proper TTY settings for true interactivity
const proc = $`top`.run({
  stdin: 'inherit', // Forward stdin directly
  mirror: false, // Don't mirror - we want direct terminal output
});

// Handle process completion
proc.on('end', (result) => {
  console.log(`\n=== top exited with code: ${result.code} ===`);
});

// Start the process and wait for it to complete
await proc;
