#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Debug Which Pipeline Method is Used ===\n');

// Enable verbose tracing to see which pipeline method is called
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('Testing pipeline command:');
const proc = $`printf '{"test": "data"}' | jq --color-output .`;

proc.on('stdout', (chunk) => {
  console.log('STDOUT EVENT - Type:', typeof chunk, chunk.constructor.name);
  console.log('STDOUT EVENT - Bytes:', Buffer.from(chunk.slice(0, 30)));
  console.log('STDOUT EVENT - Content:');
  process.stdout.write(chunk);
  console.log('--- END STDOUT EVENT ---');
});

const result = await proc;
console.log('\nFinal result complete.');
