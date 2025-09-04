#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Minimal test for hanging ===\n');

// Test 1: Simple command without any options
console.log('Test 1: Most basic gh command');
const result1 = await $`gh --version`;
console.log('✅ Basic command works\n');

// Test 2: Command with capture but no mirror
console.log('Test 2: With capture: true, mirror: false');
const result2 = await $`gh --version`.run({ capture: true, mirror: false });
console.log('Exit code:', result2.code);
console.log('✅ Capture works\n');

// Test 3: Command that fails
console.log('Test 3: Command that should fail');
try {
  const result3 = await $`gh gist view nonexistent-id`.run({ capture: true, mirror: false });
  console.log('Exit code:', result3.code);
  console.log('Stdout:', result3.stdout);
  console.log('Stderr:', result3.stderr);
} catch (error) {
  console.log('Caught error:', error.message);
  console.log('Exit code:', error.code);
}

console.log('\n=== All tests completed ===');