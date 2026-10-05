#!/usr/bin/env node

import { $, enableErrExit } from '../src/$.mjs';

console.log('=== Errexit Test ===');

enableErrExit();

try {
  await $`exit 1`;
  console.log('ERROR: Should have thrown');
} catch (error) {
  console.log('✅ Properly caught error:', error.code);
}

console.log('Errexit test completed.');
