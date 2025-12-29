#!/usr/bin/env node

// Using .run() alias with both mirror and capture options

import { $ } from '../js/src/$.mjs';

console.log('Testing $`echo test`.run({ mirror: false, capture: true }):');
const result = await $`echo "test with both options"`.run({
  mirror: false,
  capture: true,
});
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should have content
console.log('Result code:', result.code);
