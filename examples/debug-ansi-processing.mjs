#!/usr/bin/env node

import { $, processOutput, getAnsiConfig } from '../$.mjs';

console.log('=== Debug ANSI Processing ===\n');

console.log('1. Current global ANSI config:');
console.log(getAnsiConfig());

console.log('\n2. Testing processOutput function directly:');
const testData = '\x1b[31mRed text\x1b[0m normal text';
console.log('Input:', JSON.stringify(testData));
const processed = processOutput(testData);
console.log('Processed:', JSON.stringify(processed));
console.log('Are they equal?', testData === processed);

console.log('\n3. Testing with jq command and manual event handling:');
const proc = $`echo '{"test": "value"}' | jq --color-output .`;

let rawChunks = [];
let processedChunks = [];

// Capture raw stdout before processing
proc.child.stdout.on('data', (chunk) => {
  rawChunks.push(chunk);
  console.log('RAW CHUNK:', JSON.stringify(chunk.toString()));
});

// Capture processed output from events
proc.on('stdout', (chunk) => {
  processedChunks.push(chunk);
  console.log('PROCESSED CHUNK:', JSON.stringify(chunk.toString()));
});

await proc;

console.log('\n4. Final comparison:');
const rawResult = Buffer.concat(rawChunks).toString();
const processedResult = Buffer.concat(processedChunks).toString();
console.log('Raw result:', JSON.stringify(rawResult));
console.log('Processed result:', JSON.stringify(processedResult));
console.log('Results identical?', rawResult === processedResult);