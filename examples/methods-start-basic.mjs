#!/usr/bin/env node

// Using .start() method

import { $ } from '../js/src/$.mjs';

console.log('Using .start() method:');
const result = await $`echo "Using .start() method"`.start({ mirror: false });
console.log(`Result: ${JSON.stringify(result.stdout)}`);
console.log(`Code: ${result.code}`);
