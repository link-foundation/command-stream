#!/usr/bin/env node

// Using .start() with capture: false

import { $ } from '../js/src/$.mjs';

console.log('Testing $`echo test`.start({ capture: false }):');
const result = await $`echo "test with capture false"`.start({
  capture: false,
});
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should be undefined
console.log('Result code:', result.code);
