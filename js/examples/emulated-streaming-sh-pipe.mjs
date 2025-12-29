#!/usr/bin/env bun

// Using sh -c with pipe

import { $ } from '../js/src/$.mjs';

console.log('Using sh -c with pipe:');
const start = Date.now();

const cmd = $`sh -c 'bun run js/examples/emulate-claude-stream.mjs | jq .'`;
for await (const chunk of cmd.stream()) {
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
