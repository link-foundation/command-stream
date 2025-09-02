#!/usr/bin/env node

// Both .start() and .run() support all the same options

import { $ } from '../src/$.mjs';

console.log('Both support all the same options:');

// Test with multiple options using .start()
console.log('.start() with multiple options:');
const startResult = await $`cat`.start({
  stdin: "Input for start method",
  capture: true,
  mirror: false
});
console.log(`Output: ${JSON.stringify(startResult.stdout)}`);

// Test with multiple options using .run()
console.log('\n.run() with multiple options:');
const runResult = await $`cat`.run({
  stdin: "Input for run method",
  capture: true,
  mirror: false
});
console.log(`Output: ${JSON.stringify(runResult.stdout)}`);