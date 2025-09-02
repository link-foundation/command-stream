#!/usr/bin/env bun

// EventEmitter pattern with pipes

import { $ } from '../src/$.mjs';

console.log('EventEmitter pattern with pipes:');
const start = Date.now();

await new Promise((resolve) => {
  $`sh -c 'echo "{\\"event\\":1}"; sleep 0.2; echo "{\\"event\\":2}"; sleep 0.2; echo "{\\"event\\":3}"' | jq -c .`
    .on('data', (chunk) => {
      if (chunk.type === 'stdout') {
        const elapsed = Date.now() - start;
        const data = chunk.data.toString().trim();
        if (data) {
          console.log(`[${elapsed}ms] Event: ${data}`);
        }
      }
    })
    .on('end', (result) => {
      console.log(`Exit code: ${result.code}`);
      resolve();
    });
});

console.log('\n✅ Test complete');