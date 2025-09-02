#!/usr/bin/env bun

// Real-time streaming through jq pipe

import { $ } from '../src/$.mjs';

console.log('Real-time streaming with delays through jq:');
console.log('Each line should appear immediately, not all at once\n');

const start = Date.now();
const cmd = $`sh -c 'echo "{\\"n\\":1}"; sleep 0.5; echo "{\\"n\\":2}"; sleep 0.5; echo "{\\"n\\":3}"' | jq -c .`;

for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] Received: ${data}`);
    }
  }
}

console.log('\n✅ Test complete');