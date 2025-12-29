#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

// Simple working example - generate numbers with delay to see real streaming
console.log('🚀 Real streaming example');

let count = 0;
for await (const chunk of $`sh -c 'for i in 1 2 3; do echo "Chunk $i"; sleep 0.5; done'`.stream()) {
  console.log(`Event ${++count}: ${chunk.data.toString().trim()}`);
}

console.log(`✅ Got ${count} streaming events`);
