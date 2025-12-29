#!/usr/bin/env bun

// Emulator piped through jq

import { $ } from '../js/src/$.mjs';

console.log('Emulator piped through jq:');
const start = Date.now();

for await (const chunk of $`bun run js/examples/emulate-claude-stream.mjs | jq .`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const lines = chunk.data
      .toString()
      .trim()
      .split('\n')
      .filter((l) => l);
    for (const line of lines) {
      console.log(`[${elapsed}ms] ${line}`);
    }
  }
}
