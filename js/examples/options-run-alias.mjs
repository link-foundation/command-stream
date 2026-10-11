#!/usr/bin/env node

// Using .run() alias with capture: false

import { $ } from '../src/$.mjs';

console.log('Testing $`echo test`.run({ capture: false }):');
const result = await $`echo "test with run alias"`.run({ capture: false });
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should be undefined
console.log('Result code:', result.code);
