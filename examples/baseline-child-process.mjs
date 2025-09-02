#!/usr/bin/env node
// Baseline test using standard Node.js child_process
import { spawn } from 'child_process';

console.log('=== Baseline test with Node.js child_process ===');

let chunkCount = 0;
const child = spawn('claude', ['hi'], { stdio: 'pipe' });

child.stdout.on('data', (data) => {
  chunkCount++;
  console.log(`Raw chunk ${chunkCount}:`, data.toString());
});

child.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

child.on('close', (code) => {
  console.log(`Process closed with code ${code}, received ${chunkCount} chunks`);
});