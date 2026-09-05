#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Finish Method Consolidation Test ===');

// Test different scenarios that should all use the finish() method
const tests = [
  async () => {
    console.log('\n1. Testing normal completion...');
    const result = await $`echo "test"`;
    console.log('Result:', result.stdout);
  },

  async () => {
    console.log('\n2. Testing sync mode...');
    const result = $`echo "sync test"`.sync();
    console.log('Result:', result.stdout);
  },

  async () => {
    console.log('\n3. Testing error handling...');
    try {
      await $`exit 1`;
    } catch (error) {
      console.log('Expected error, code:', error.code);
    }
  },

  async () => {
    console.log('\n4. Testing pipeline...');
    try {
      await $`echo "test" | exit 1`;
    } catch (error) {
      console.log('Expected pipeline error, code:', error.code);
    }
  },
];

for (const test of tests) {
  await test();
}

console.log('\nAll tests completed successfully!');
