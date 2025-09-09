#!/usr/bin/env node
// Debug script to examine ProcessRunner result structure

import { $ } from '../src/$.mjs';

console.log('=== Testing ProcessRunner Result Structure ===');

try {
  const result = await $`echo test`;
  console.log('Success result properties:');
  console.log('Keys:', Object.keys(result));
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}

console.log('\n=== Testing Failed Command ===');

try {
  const result = await $`false`;
  console.log('This should not execute');
} catch (error) {
  console.log('Error result properties:');
  console.log('Keys:', Object.keys(error));
  console.log('Error:', JSON.stringify(error, null, 2));
}

console.log('\n=== Testing with reject: false ===');

try {
  const result = await $({ reject: false })`false`;
  console.log('No-reject result properties:');
  console.log('Keys:', Object.keys(result));
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Unexpected error:', error);
}