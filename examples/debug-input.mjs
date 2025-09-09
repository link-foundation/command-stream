#!/usr/bin/env node

import { execa } from '../src/$.mjs';

console.log('=== Testing Input Handling ===');

try {
  const result = await execa('cat', [], { input: 'test input' });
  console.log('Result stdout:', JSON.stringify(result.stdout));
  console.log('Result keys:', Object.keys(result));
  console.log('Full result:', result);
} catch (error) {
  console.error('Error:', error.message);
}