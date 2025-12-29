#!/usr/bin/env node

process.env.COMMAND_STREAM_VERBOSE = 'true';

import { $ } from '../js/src/$.mjs';

console.log('=== StreamEmitter Debug ===');

const cmd = $`echo "test"`;

cmd.on('data', (chunk) => {
  console.log('[LISTENER] data received:', chunk.type);
});

cmd.on('end', (result) => {
  console.log('[LISTENER] end received:', result.code);
});

cmd.on('exit', (code) => {
  console.log('[LISTENER] exit received:', code);
});

console.log('Starting await...');
await cmd;
console.log('Await completed');
