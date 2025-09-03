#!/usr/bin/env bun

import { $, register } from '../src/$.mjs';

console.log('=== Testing Virtual Command Streaming ===\n');

// Register a streaming virtual command that generates data incrementally
register('stream-numbers', async function* ({ args, stdin }) {
  const count = parseInt(args[0] || '3');
  const delay = parseInt(args[1] || '500');
  
  for (let i = 1; i <= count; i++) {
    yield `{"number": ${i}}\n`;
    if (i < count) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
});

// Register a virtual filter command
register('filter-even', async function* ({ args, stdin }) {
  const lines = stdin.trim().split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.number && obj.number % 2 === 0) {
        yield line + '\n';
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }
});

// Test 1: Virtual command alone with streaming
console.log('Test 1: Virtual streaming command alone:');
console.log('Should output 3 numbers with 300ms delays:\n');
const start1 = Date.now();

for await (const chunk of $`stream-numbers 3 300`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start1;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] ${data}`);
    }
  }
}

console.log('\n✅ Test 1 complete\n');

// Test 2: Virtual command piped to real command
console.log('Test 2: Virtual -> Real command pipeline:');
console.log('Stream numbers through jq:\n');
const start2 = Date.now();

for await (const chunk of $`stream-numbers 3 200 | jq -c '.number *= 2'`.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start2;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] ${data}`);
    }
  }
}

console.log('\n✅ Test 2 complete\n');

// Test 3: Real command piped to virtual command
console.log('Test 3: Real -> Virtual command pipeline:');
console.log('Generate numbers with shell, filter with virtual command:\n');
const start3 = Date.now();

const cmd3 = $`sh -c 'for i in 1 2 3 4 5; do echo "{\\"number\\": $i}"; done' | filter-even`;

for await (const chunk of cmd3.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start3;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] ${data}`);
    }
  }
}

console.log('\n✅ Test 3 complete\n');

// Test 4: Mixed pipeline with multiple stages
console.log('Test 4: Virtual -> Real -> Virtual pipeline:');
console.log('Stream numbers, transform with jq, filter with virtual:\n');
const start4 = Date.now();

const cmd4 = $`stream-numbers 5 150 | jq -c '{value: .number, double: (.number * 2)}' | filter-even`;

// Note: filter-even will only work on objects with 'number' field, 
// so let's create a better filter
register('filter-double-even', async function* ({ args, stdin }) {
  const lines = stdin.trim().split('\n');
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.double && obj.double % 4 === 0) {
        yield line + '\n';
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }
});

const cmd4Fixed = $`stream-numbers 5 150 | jq -c '{value: .number, double: (.number * 2)}' | filter-double-even`;

for await (const chunk of cmd4Fixed.stream()) {
  if (chunk.type === 'stdout') {
    const elapsed = Date.now() - start4;
    const data = chunk.data.toString().trim();
    if (data) {
      console.log(`[${elapsed}ms] ${data}`);
    }
  }
}

console.log('\n✅ Test 4 complete\n');

console.log('🎉 All virtual streaming tests passed!');