#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

console.log('=== Debug Tee Streaming ===\n');

// Patch the emit function to trace calls
const cmd = $`bun run js/examples/emulate-claude-stream.mjs | cat | jq .`;
const originalEmit = cmd.emit.bind(cmd);
let emitCount = 0;

cmd.emit = function (event, data) {
  if (event === 'stdout' || event === 'data') {
    emitCount++;
    const preview = data.toString
      ? data.toString().substring(0, 40)
      : JSON.stringify(data).substring(0, 40);
    console.log(`EMIT #${emitCount} [${event}]: ${preview}...`);
  }
  return originalEmit(event, data);
};

console.log('Running command...\n');
const start = Date.now();

const result = await cmd;

console.log(`\nTotal emits: ${emitCount}`);
console.log(`Time taken: ${Date.now() - start}ms`);
console.log(`Result length: ${result.stdout.length} chars`);

if (emitCount >= 8) {
  console.log('✅ Multiple emissions detected - streaming is working!');
} else if (emitCount === 2) {
  console.log('⚠️  Only 2 emissions (stdout + data) - likely buffered');
} else {
  console.log(`❌ Unexpected emit count: ${emitCount}`);
}
