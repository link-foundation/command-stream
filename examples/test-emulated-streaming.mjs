#!/usr/bin/env bun

import { $ } from '../$.mjs';

console.log('=== Testing Streaming with Emulated Claude Output ===\n');

console.log('Test 1: Direct execution of emulator:');
const start1 = Date.now();

for await (const chunk of $`bun run examples/emulate-claude-stream.mjs`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start1;
    const lines = chunk.data.toString().trim().split('\n').filter(l => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}

console.log('\nTest 2: Emulator piped through jq:');
const start2 = Date.now();

for await (const chunk of $`bun run examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const lines = chunk.data.toString().trim().split('\n').filter(l => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}

console.log('\nTest 3: Using sh -c with pipe:');
const start3 = Date.now();

const cmd = $`sh -c 'bun run examples/emulate-claude-stream.mjs | jq .'`;
for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start3;
    const lines = chunk.data.toString().trim().split('\n').filter(l => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}