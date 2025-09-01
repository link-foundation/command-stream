#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Stream Events Debug ===');

console.log('Testing with manual event handlers:');
const cmd = $`echo "hello world"`;

cmd.on('data', (chunk) => {
  console.log('Event: data', chunk.type, JSON.stringify(chunk.data.toString().trim()));
});

cmd.on('stdout', (chunk) => {
  console.log('Event: stdout', JSON.stringify(chunk.toString().trim()));
});

cmd.on('stderr', (chunk) => {
  console.log('Event: stderr', JSON.stringify(chunk.toString().trim()));
});

cmd.on('end', (result) => {
  console.log('Event: end', {
    code: result.code,
    stdout: JSON.stringify(result.stdout.trim()),
    stderr: JSON.stringify(result.stderr.trim())
  });
});

cmd.on('exit', (code) => {
  console.log('Event: exit', code);
});

console.log('Starting command...');
const result = await cmd;
console.log('Command completed with code:', result.code);

console.log('=== Stream Iterator Debug ===');
console.log('Now testing stream iterator:');

const cmd2 = $`echo "test stream"`;
let chunkCount = 0;
let startTime = Date.now();

try {
  for await (const chunk of cmd2.stream()) {
    chunkCount++;
    const elapsed = Date.now() - startTime;
    console.log(`Stream chunk ${chunkCount} at ${elapsed}ms:`, chunk.type, JSON.stringify(chunk.data.toString().trim()));
    
    // Safety break to prevent infinite loop
    if (chunkCount >= 5) {
      console.log('Safety break activated');
      break;
    }
  }
  console.log('Stream iterator completed naturally');
} catch (error) {
  console.log('Stream iterator error:', error.message);
}

console.log('Debug completed!');