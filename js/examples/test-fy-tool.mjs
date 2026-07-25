#!/usr/bin/env bun

/**
 * Test script for the $fy tool
 */

import { $ } from '../src/$.mjs';

console.log('=== Testing $fy Tool ===\n');

// Test 1: Help message
console.log('1. Testing help message:');
try {
  const help = await $`$fy`;
  console.log(help.stderr);
} catch (error) {
  console.log('Help result:', error.code);
}

console.log('\n2. Testing simple command conversion from stdin:');
// Test 2: Simple command from stdin
try {
  const result = await $({ stdin: 'ls -la' })`$fy`;
  console.log('Converted command:');
  console.log(result.stdout);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n3. Testing pipeline command from stdin:');
// Test 3: Pipeline command from stdin  
try {
  const result = await $({ stdin: 'ls -la | grep test' })`$fy`;
  console.log('Converted pipeline:');
  console.log(result.stdout);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n4. Testing shell operators from stdin:');
// Test 4: Shell operators
try {
  const result = await $({ stdin: 'cd /tmp && pwd && ls' })`$fy`;
  console.log('Converted sequence:');
  console.log(result.stdout);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('=== $fy Tool Test Complete ===');