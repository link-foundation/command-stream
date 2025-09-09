#!/usr/bin/env node

import { execa, buildShellCommand } from '../src/$.mjs';

console.log('=== Simple Template Test ===');

// Test 1: Check if buildShellCommand is accessible
console.log('buildShellCommand available?', typeof buildShellCommand);

// Test 2: Manual template call
const strings = ['echo ', ''];
const values = ['test'];

console.log('strings:', strings);
console.log('values:', values);

try {
  const result = await execa(strings, values);
  console.log('Template result:', result.stdout);
} catch (error) {
  console.error('Error:', error.message);
}

// Test 3: Direct function call
try {
  const directResult = await execa('echo', ['direct']);
  console.log('Direct result:', directResult.stdout);
} catch (error) {
  console.error('Direct error:', error.message);
}