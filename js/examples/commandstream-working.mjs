#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('🤖 Command-stream: Claude with stdin');

let chunkCount = 0;

const command = $({
  stdin: 'hi\n',
})`claude --output-format stream-json --verbose --model sonnet`;

command
  .on('data', (chunk) => {
    chunkCount++;
    console.log(`📦 CHUNK ${chunkCount}:`);
    console.log(chunk.data.toString());
    console.log('---');
  })
  .on('end', (result) => {
    console.log(`✅ Got ${chunkCount} chunks, exit: ${result.code}`);
  })
  .start();
