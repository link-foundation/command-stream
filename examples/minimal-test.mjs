#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Minimal Test ===');

async function test() {
  const result = await $`echo "test"`;
  
  console.log('result:', result);
  console.log('result.stdout:', result.stdout);
  console.log('typeof result.stdout:', typeof result.stdout);
  console.log('result.stdout.constructor:', result.stdout.constructor);
  console.log('result.stdout instanceof Object:', result.stdout instanceof Object);
  
  // Let's try to access the object directly
  console.log('Object.getPrototypeOf(result.stdout):', Object.getPrototypeOf(result.stdout));
  console.log('result.stdout.__proto__:', result.stdout.__proto__);
}

test().catch(console.error);