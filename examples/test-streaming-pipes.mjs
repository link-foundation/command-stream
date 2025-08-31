#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Testing Real-Time Streaming with Pipes ===\n');

// Test 1: Real-time streaming through pipe
console.log('Test 1: Real-time streaming with delays through jq:');
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

console.log('\n✅ Test 1 complete\n');

// Test 2: Complex pipeline with real-time streaming
console.log('Test 2: Multi-stage pipeline with streaming:');
const start2 = Date.now();

const cmd2 = $`sh -c 'for i in 1 2 3; do echo "{\\"value\\":$i}"; sleep 0.3; done' | jq -c '{data: .value}' | jq -c '{result: (.data * 2)}'`;

for await (const chunk of cmd2.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] Pipeline result: ${data}`);
    }
  }
}

console.log('\n✅ Test 2 complete\n');

// Test 3: EventEmitter with pipes
console.log('Test 3: EventEmitter pattern with pipes:');
const start3 = Date.now();

await new Promise((resolve) => {
  $`sh -c 'echo "{\\"event\\":1}"; sleep 0.2; echo "{\\"event\\":2}"; sleep 0.2; echo "{\\"event\\":3}"' | jq -c .`
    .on('data', (chunk) => {
      if (chunk.type === 'stdout') {
        const elapsed = Date.now() - start3;
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

console.log('\n✅ Test 3 complete\n');

console.log('🎉 All streaming tests passed!');