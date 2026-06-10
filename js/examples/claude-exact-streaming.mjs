#!/usr/bin/env node

import { $ } from '../src/$.mjs';

const claude = 'claude';
console.log('🤖 Claude exact streaming example');

let events = 0;
for await (const chunk of $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`.stream()) {
  console.log(`📦 Event ${++events}: ${chunk.data.toString().trim()}`);
}

console.log(`✅ Received ${events} streaming events`);
