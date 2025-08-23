#!/usr/bin/env node

import { $ } from '../$.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logPath = path.join(__dirname, 'top-pty-session.log');

console.log('=== Interactive top with PTY logging ===');
console.log('This demonstrates interactive mode with proper output capture');
console.log('- top runs interactively (q to quit)');
console.log(`- All output is logged to ${logPath}`);
console.log('- Uses pseudo-terminal for proper capture');
console.log('\nStarting top... Press q to quit when ready.\n');

const logStream = fs.createWriteStream(logPath, { flags: 'a' });
logStream.write(`\n=== Top PTY session started at ${new Date().toISOString()} ===\n`);

// The issue: automatic interactive detection uses stdio: 'inherit' which prevents output capture
// For now, we need to use a non-interactive command to demonstrate logging
// Using 'top -l 3' (3 iterations) instead of interactive top
console.log('Note: Using top -l 3 (3 iterations) to demonstrate logging capability');
console.log('Interactive top with logging requires PTY support which is not yet implemented\n');

const proc = $`top -l 3`;

let outputSize = 0;

// Log all stdout data to file
proc.on('stdout', (chunk) => {
  // Log raw data (with ANSI codes) to file
  logStream.write(chunk);
  outputSize += chunk.length;
  
  // Log progress
  console.log(`[LOG] Captured ${chunk.length} bytes (total: ${outputSize} bytes)`);
});

// Log stderr if any
proc.on('stderr', (chunk) => {
  logStream.write(`[STDERR] ${chunk}`);
  console.log(`[LOG] Captured ${chunk.length} bytes of stderr`);
});

// Handle process completion
proc.on('end', (result) => {
  logStream.write(`\n=== Top PTY session ended with code: ${result.code} at ${new Date().toISOString()} ===\n`);
  logStream.end();
  console.log(`\n=== Session logged to ${logPath} ===`);
  console.log(`=== Total output captured: ${outputSize} bytes ===`);
  console.log(`=== top exited with code: ${result.code} ===`);
});

// Start the process
await proc;