#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function test() {
  const result = await $`echo "test content"`;
  
  console.log('Testing Jest/Bun compatibility:');
  console.log('result.stdout:', result.stdout);
  console.log('typeof result.stdout:', typeof result.stdout);
  console.log('result.stdout.toString():', result.stdout.toString());
  console.log('result.stdout.includes("test"):', result.stdout.includes("test"));
  console.log('String(result.stdout):', String(result.stdout));
  console.log('JSON.stringify(result.stdout):', JSON.stringify(result.stdout));
  
  // Test what happens when we try to use includes
  try {
    console.log('Direct includes call:', result.stdout.includes('test'));
  } catch (e) {
    console.log('Error with includes:', e.message);
  }
  
  // Test with conversion
  console.log('Convert to string first:', String(result.stdout).includes('test'));
}

test().catch(console.error);