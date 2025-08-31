#!/usr/bin/env node

// capture: false and mirror: false together (maximum performance)

import { $ } from '../src/$.mjs';

console.log('Testing $`echo test`.start({ capture: false, mirror: false }):');
const result = await $`echo "no capture, no mirror"`.start({ capture: false, mirror: false });
console.log('Result stdout:', JSON.stringify(result.stdout)); // Should be undefined
console.log('Result code:', result.code);