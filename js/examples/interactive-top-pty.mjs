#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('=== Truly Interactive top command ===');
console.log(
  'This version uses direct spawn with stdio: "inherit" for full TTY support'
);
console.log('- Keyboard input works (q to quit, space to refresh, etc.)');
console.log('- ANSI colors and formatting preserved');
console.log('- Full terminal interaction');
console.log('\nStarting top... Press q to quit when ready.\n');

// Use Node.js spawn directly with stdio: 'inherit' for true TTY forwarding
const topProcess = spawn('top', [], {
  stdio: 'inherit', // This forwards stdin, stdout, stderr directly to/from terminal
  cwd: process.cwd(),
  env: process.env,
});

topProcess.on('close', (code) => {
  console.log(`\n=== top exited with code: ${code} ===`);
});

topProcess.on('error', (error) => {
  console.error('Error starting top:', error.message);
});
