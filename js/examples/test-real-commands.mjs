#!/usr/bin/env bun

import { $ } from '../js/src/$.mjs';

console.log('Test with real commands only (no virtual echo):\n');

// Use printf instead of echo to avoid virtual command
const result = await $`printf '{"test":1}\\n' | jq .`;
console.log('Result:', result.stdout);

console.log('\nTest streaming:');
const start = Date.now();
for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data.toString().trim().split('\n').slice(0, 2);
    if (lines[0]) {
      console.log(`[${elapsed}ms] ${lines[0]}`);
    }
  }
}
