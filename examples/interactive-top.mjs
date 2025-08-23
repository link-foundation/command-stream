#!/usr/bin/env node

import { $ } from '../$.mjs';

console.log('=== Interactive top command (preserves ANSI colors and interactive controls) ===');
console.log('This will run top interactively. Press q to quit when ready.\n');

// Start top in interactive mode - no time limits, full interactivity
const proc = $`top`;

// Forward all stdout to terminal (preserving colors and formatting)
proc.on('stdout', (chunk) => {
  process.stdout.write(chunk);
});

// Forward stderr if any
proc.on('stderr', (chunk) => {
  process.stderr.write(chunk);
});

// Handle process completion
proc.on('end', (result) => {
  console.log(`\n=== top exited with code: ${result.code} ===`);
});

// Start the process
await proc;