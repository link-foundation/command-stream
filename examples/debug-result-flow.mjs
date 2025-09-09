#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Debug Result Flow ===');

// Add debug to console.log to see what gets returned
const originalLog = console.log;
console.log = (...args) => {
  if (args[0] && args[0].includes && args[0].includes('[DEBUG]')) {
    originalLog('[TRACED]', ...args);
  } else {
    originalLog(...args);
  }
};

async function test() {
  console.log('About to run echo command...');
  const result = await $`echo "test"`;
  
  console.log('Result received:');
  console.log('  result:', result);
  console.log('  result keys:', Object.keys(result));
  console.log('  result.code:', result.code);
  console.log('  result.stdout:', result.stdout);
  console.log('  result.stderr:', result.stderr);
  console.log('  result.stdin:', result.stdin);
}

test().catch(console.error);