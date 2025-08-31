#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing CTRL+C signal propagation');
console.log('Press CTRL+C to interrupt...');
console.log('---');

// Set up comprehensive signal handlers
let parentSigintCount = 0;
process.on('SIGINT', () => {
  parentSigintCount++;
  console.log(`\n[Parent] Received SIGINT (count: ${parentSigintCount})`);
  
  // Don't exit on first SIGINT to see what happens
  if (parentSigintCount >= 2) {
    console.log('[Parent] Exiting after 2 SIGINTs');
    process.exit(130);
  }
});

process.on('SIGTERM', () => {
  console.log('\n[Parent] Received SIGTERM');
});

process.on('exit', (code) => {
  console.log(`[Parent] Exiting with code: ${code}`);
});

// Test the command
try {
  console.log('Starting sleep 30...');
  console.log('Process info:', {
    pid: process.pid,
    ppid: process.ppid
  });
  
  const result = await $`sleep 30`;
  console.log('Command completed normally');
} catch (error) {
  console.log('\n[Parent] Command failed/interrupted');
  console.log('Error message:', error.message);
  console.log('Exit code:', error.code);
}