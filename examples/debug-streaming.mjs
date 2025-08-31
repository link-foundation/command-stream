#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Debug Streaming Test ===\n');

// Test without pipe first
console.log('Test 1: No pipe (should work):');
try {
  const result = await $`echo "hello"`;
  console.log('Result:', result.stdout);
} catch (e) {
  console.error('Error:', e.message);
}

// Test with simple pipe
console.log('\nTest 2: Simple pipe:');
try {
  const result = await $`echo "hello" | cat`;
  console.log('Result:', result.stdout);
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stack:', e.stack);
}