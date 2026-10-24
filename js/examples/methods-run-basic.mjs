#!/usr/bin/env node

// Using .run() method (identical functionality to .start())

import { $ } from '../src/$.mjs';

console.log('Using .run() method (identical functionality):');
const result = await $`echo "Using .run() method"`.run({ mirror: false });
console.log(`Result: ${JSON.stringify(result.stdout)}`);
console.log(`Code: ${result.code}`);
