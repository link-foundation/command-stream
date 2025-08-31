#!/usr/bin/env bun

// Multi-stage pipeline with streaming

import { $ } from '../src/$.mjs';

console.log('Multi-stage pipeline with streaming:');
const start = Date.now();

const cmd = $`sh -c 'for i in 1 2 3; do echo "{\\"value\\":$i}"; sleep 0.3; done' | jq -c '{data: .value}' | jq -c '{result: (.data * 2)}'`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] Pipeline result: ${data}`);
    }
  }
}

console.log('\n✅ Test complete');