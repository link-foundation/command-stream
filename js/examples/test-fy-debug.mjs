#!/usr/bin/env bun

/**
 * Debug the $fy tool to see what it receives
 */

import { register, $ } from '../src/$.mjs';

// Register a debug version
register('$fy-debug', async ({ args, stdin, options }) => {
  console.log('DEBUG - args:', args);
  console.log('DEBUG - stdin:', stdin);
  console.log('DEBUG - stdin type:', typeof stdin);
  console.log('DEBUG - stdin length:', stdin ? stdin.length : 'null/undefined');
  console.log('DEBUG - options:', options);
  
  return {
    stdout: 'Debug info printed to stderr\n',
    code: 0
  };
});

console.log('=== Testing $fy Debug ===\n');

// Test with file
console.log('Testing with file:');
const result = await $`$fy-debug examples/sample-script.sh`;
console.log('Result:', result.stdout);

console.log('\nTesting with stdin:');
const result2 = await $({ stdin: 'ls -la' })`$fy-debug`;
console.log('Result2:', result2.stdout);