#!/usr/bin/env node

// Default behavior comparison (direct await)

import { $ } from '../src/$.mjs';

console.log('Testing default await $`echo test` (for comparison):');
const result = await $`echo "test default behavior"`;
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should have content
console.log('Result code:', result.code);