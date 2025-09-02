#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Testing jq color output in pipelines ===\n');

// Test 1: Direct jq with color output
console.log('1. Direct jq command with --color-output:');
const directResult = await $`echo '{"name": "test", "value": 42, "active": true}' | jq --color-output .`;
console.log('Raw output:');
process.stdout.write(directResult.stdout);
console.log('\nRaw bytes (first 100):');
console.log(Buffer.from(directResult.stdout.slice(0, 100)));

console.log('\n2. Pipeline with jq --color-output:');
const pipeResult = await $`echo '{"users": [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]}' | jq --color-output '.users[]'`;
console.log('Raw output:');
process.stdout.write(pipeResult.stdout);

console.log('\n3. Testing if jq auto-detects color capability:');
const autoResult = await $`echo '{"test": "data"}' | jq .`;
console.log('Raw output (should have colors if terminal supports it):');
process.stdout.write(autoResult.stdout);

console.log('\n4. Testing streaming behavior:');
const streamProc = $`printf '{"a":1}\\n{"b":2}\\n{"c":3}\\n' | jq --color-output -c .`;

console.log('Streaming output:');
streamProc.on('stdout', (chunk) => {
  process.stdout.write('CHUNK: ');
  process.stdout.write(chunk);
});

await streamProc;

console.log('\n=== Analysis ===');
console.log('- Direct jq should show colors if --color-output is used');
console.log('- Pipeline should preserve ANSI codes in streaming');
console.log('- Check raw bytes to see ANSI escape sequences (\\x1b[...)');