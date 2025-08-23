#!/usr/bin/env node

import { $ } from '../$.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logPath = path.join(__dirname, 'top-session.log');

console.log('=== Interactive top with logging ===');
console.log('This demonstrates interactive mode while logging all output to files');
console.log('- top runs interactively (q to quit)');
console.log(`- All output is logged to ${logPath}`);
console.log('- All input can be captured too');
console.log('\nStarting top... Press q to quit when ready.\n');

const logStream = fs.createWriteStream(logPath, { flags: 'a' });
logStream.write(`\n=== Top session started at ${new Date().toISOString()} ===\n`);

// Start top - it will run interactively
const proc = $`top`;

// Log all stdout data to file while maintaining interactivity
proc.on('stdout', (chunk) => {
  // Log raw data (with ANSI codes) to file
  logStream.write(chunk);
  
  // Also log processed data for debugging
  console.log(`[LOG] Captured ${chunk.length} bytes of stdout`);
});

// Log stderr if any
proc.on('stderr', (chunk) => {
  logStream.write(`[STDERR] ${chunk}`);
  console.log(`[LOG] Captured ${chunk.length} bytes of stderr`);
});

// Handle process completion
proc.on('end', (result) => {
  logStream.write(`\n=== Top session ended with code: ${result.code} at ${new Date().toISOString()} ===\n`);
  logStream.end();
  console.log(`\n=== Session logged to ${logPath} ===`);
  console.log(`=== top exited with code: ${result.code} ===`);
});

// Start the process
await proc;