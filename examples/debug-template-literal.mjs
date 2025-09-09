#!/usr/bin/env node

import { execa } from '../src/$.mjs';

console.log('=== Testing Template Literal Handling ===');

const message = 'hello template';
console.log('message:', message);

try {
  const result = await execa`echo ${message}`;
  console.log('Result stdout:', JSON.stringify(result.stdout));
  console.log('Result keys:', Object.keys(result));
} catch (error) {
  console.error('Error:', error.message);
  console.error('Full error:', error);
}