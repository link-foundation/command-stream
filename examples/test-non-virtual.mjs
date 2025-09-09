#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Testing Non-Virtual Command ===');

async function test() {
  // Use a command that's likely not virtualized (like node)
  const result = await $`node -e "console.log('hello')"`;
  
  console.log('Result received:');
  console.log('  result:', result);
  console.log('  result keys:', Object.keys(result));
  console.log('  result.stdout type:', typeof result.stdout);
  console.log('  result.stdout constructor:', result.stdout?.constructor?.name);
  console.log('  result.stdin type:', typeof result.stdin);
}

test().catch(console.error);