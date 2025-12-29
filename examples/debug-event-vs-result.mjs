#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Event vs Result Comparison ===\n');

console.log('1. Using await result (final result):');
const result1 = await $`echo '{"test": "result"}' | jq --color-output .`;
console.log('Final result:');
process.stdout.write(result1.stdout);
console.log('Result bytes:', Buffer.from(result1.stdout.slice(0, 30)));

console.log('\n2. Using stdout events (streaming):');
const proc2 = $`echo '{"test": "events"}' | jq --color-output .`;

console.log('Event output:');
proc2.on('stdout', (chunk) => {
  console.log('Event chunk type:', typeof chunk, chunk.constructor.name);
  console.log('Event chunk bytes:', Buffer.from(chunk.slice(0, 30)));
  console.log('Event chunk content:');
  process.stdout.write(chunk);
  console.log('---');
});

const result2 = await proc2;

console.log('\n3. Comparison:');
console.log('Final result from streaming proc:');
process.stdout.write(result2.stdout);
console.log('Final result bytes:', Buffer.from(result2.stdout.slice(0, 30)));
