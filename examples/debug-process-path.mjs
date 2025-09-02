#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Process Path Debug ===');

// Enable verbose tracing to see which code path is taken
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('Testing simple echo command path...');
const cmd = $`echo "test"`;

// Add event listeners to track what happens
cmd.on('data', (chunk) => {
  console.log('[EVENT] data:', chunk.type, JSON.stringify(chunk.data.toString().trim()));
});

cmd.on('end', (result) => {
  console.log('[EVENT] end:', result.code, JSON.stringify(result.stdout.trim()));
});

cmd.on('exit', (code) => {
  console.log('[EVENT] exit:', code);
});

console.log('Awaiting result...');
const result = await cmd;
console.log('Final result:', result.code, JSON.stringify(result.stdout.trim()));

console.log('Process path debug completed!');