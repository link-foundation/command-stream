#!/usr/bin/env bun

// Direct execution of emulator

import { $ } from '../src/$.mjs';

console.log('Direct execution of emulator:');
const start = Date.now();

for await (const chunk of $`bun run examples/emulate-claude-stream.mjs`.stream()) {
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
