#!/usr/bin/env node

// Using .start() with mirror: false

import { $ } from '../js/src/$.mjs';

console.log('Testing $`echo test`.start({ mirror: false }):');
const result = await $`echo "test with mirror false"`.start({ mirror: false });
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should have content
console.log('Result code:', result.code);
