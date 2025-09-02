#!/usr/bin/env node

// Basic ping streaming with timestamps

import { $ } from '../src/$.mjs';

console.log('Basic streaming with timestamps:');
console.log('Running ping -c 5 google.com...\n');

try {
  for await (const chunk of $`ping -c 5 google.com`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}