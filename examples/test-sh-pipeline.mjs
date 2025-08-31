#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('Testing pipeline executed via sh -c:');
console.log('This should stream in real-time\n');

const start = Date.now();

// Execute the entire pipeline as a single shell command
const cmd = $`sh -c 'bun run examples/emulate-claude-stream.mjs | jq .'`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}