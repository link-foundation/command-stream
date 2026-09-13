#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== jq Streaming with ANSI Colors ===\n');

console.log('Test 1: JSON streaming with colors (using --color-output):');
const coloredCmd = $`printf '{"name":"Alice","status":"active","score":95}\n{"name":"Bob","status":"inactive","score":87}\n{"name":"Carol","status":"active","score":92}\n' | jq --color-output .`;

console.log('Streaming colored JSON:');
coloredCmd.on('stdout', (chunk) => {
  // Display raw colored output
  process.stdout.write(chunk);
});

await coloredCmd;

console.log('\nTest 2: Compact colored streaming:');
const compactCmd = $`printf '{"user":"Alice","data":{"x":1,"y":2}}\n{"user":"Bob","data":{"x":3,"y":4}}\n' | jq --color-output -c '.user + ": " + (.data.x + .data.y | tostring)'`;

compactCmd.on('stdout', (chunk) => {
  process.stdout.write('> ');
  process.stdout.write(chunk);
});

await compactCmd;

console.log('\nTest 3: Interactive-style filtering with colors:');
const filterCmd = $`printf '{"type":"user","name":"Alice"}\n{"type":"admin","name":"Bob"}\n{"type":"user","name":"Carol"}\n' | jq --color-output 'select(.type == "user")'`;

console.log('Filtered users (colored):');
filterCmd.on('stdout', (chunk) => {
  process.stdout.write(chunk);
});

await filterCmd;

console.log('\n=== Results ===');
console.log('✅ ANSI colors preserved in jq pipelines');
console.log('✅ Real-time streaming with color support');
console.log('✅ Use --color-output to force colors in pipelines');
console.log('✅ Colors work even when not connected to terminal');
