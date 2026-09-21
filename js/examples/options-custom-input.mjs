#!/usr/bin/env node

// Custom input with options

import { $ } from '../src/$.mjs';

console.log('Custom input with options:');
console.log('await $`cat`.start({ stdin: "custom", mirror: false })');
const result = await $`cat`.start({
  stdin: 'This is custom input data',
  mirror: false,
  capture: true,
});
console.log(
  `Exit code: ${result.code}, Output: ${JSON.stringify(result.stdout)}`
);
