#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Testing Native Input Handling ===');

try {
  const result = await $({ input: 'test input' })`cat`;
  console.log('Native result stdout:', JSON.stringify(result.stdout));
  console.log('Native result keys:', Object.keys(result));
} catch (error) {
  console.error('Error:', error.message);
}