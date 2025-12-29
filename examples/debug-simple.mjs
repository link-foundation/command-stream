#!/usr/bin/env node

import { $, getAnsiConfig } from '../js/src/$.mjs';

console.log('=== Simple ANSI Debug ===\n');

console.log('1. Config check:');
console.log('Global config:', getAnsiConfig());

console.log('\n2. Direct terminal write test:');
const testStr = '\x1b[31mRed text\x1b[0m normal';
console.log('Writing directly to terminal:');
process.stdout.write(`${testStr}\n`);

console.log('\n3. jq command test:');
const result = await $`echo '{"name": "test"}' | jq --color-output .`;
console.log('Result stdout type:', typeof result.stdout);
console.log('Result stdout raw bytes (first 50):');
console.log(Buffer.from(result.stdout.slice(0, 50)));

console.log('\nDirect write of result.stdout:');
process.stdout.write(result.stdout);

console.log('\n4. Manual event handling test:');
const proc = $`echo '{"name": "test"}' | jq --color-output .`;

proc.on('stdout', (chunk) => {
  console.log('Event chunk type:', typeof chunk);
  console.log('Event chunk constructor:', chunk.constructor.name);
  console.log(
    'Event chunk raw (first 30 bytes):',
    Buffer.from(chunk.slice(0, 30))
  );
  console.log('Writing event chunk directly:');
  process.stdout.write('[EVENT] ');
  process.stdout.write(chunk);
});

await proc;
