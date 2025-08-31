#!/usr/bin/env node

// Basic streaming comparison: regular $ vs $({ options })

import { $ } from '../src/$.mjs';

console.log('Basic streaming comparison:');

console.log('Regular $ syntax:');
try {
  for await (const chunk of $`echo "Hello from regular $"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`📝 Regular: ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}

console.log('\n$({ options }) syntax with mirror: false:');
const $configured = $({ mirror: false });

try {
  for await (const chunk of $configured`echo "Hello from configured $"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`⚙️  Configured: ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}