#!/usr/bin/env node

// Using .run() alias

import { $ } from '../js/src/$.mjs';

console.log('Using .run() alias:');
console.log('await $`echo "alias"`.run({ capture: true, mirror: false })');
const result = await $`echo "Using .run() instead of .start()"`.run({
  capture: true,
  mirror: false,
});
console.log(
  `Exit code: ${result.code}, Captured: ${JSON.stringify(result.stdout)}`
);
