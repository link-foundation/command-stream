#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing error handling...');

try {
  console.log('\n1. Testing regular $ with exit 1:');
  const regular = await $`exit 1`;
  console.log('Regular result (should not reach here):', regular);
} catch (error) {
  console.log('Regular caught error:', error.message);
  console.log('Regular error keys:', Object.keys(error));
}

try {
  console.log('\n2. Testing $.zx with exit 1:');
  const zx = await $.zx`exit 1`;
  console.log('ZX result (should not reach here):', zx);
} catch (error) {
  console.log('ZX caught error:', error.message);
  console.log('ZX error keys:', Object.keys(error));
  console.log('ZX error exitCode:', error.exitCode);
}