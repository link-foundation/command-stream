#!/usr/bin/env node

// Enable verbose tracing to see what command is built
process.env.COMMAND_STREAM_VERBOSE = 'true';

import { execa } from '../src/$.mjs';

console.log('=== Template Literal Trace Test ===');

const message = 'hello template';
console.log('Input message:', message);

try {
  const result = await execa`echo ${message}`;
  console.log('Final result stdout:', JSON.stringify(result.stdout));
  console.log('Expected:', JSON.stringify('hello template'));
} catch (error) {
  console.error('Error:', error.message);
}