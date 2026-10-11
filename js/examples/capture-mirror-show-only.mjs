#!/usr/bin/env node

// capture: false, mirror: true (just show output)

import { $ } from '../src/$.mjs';

console.log('capture: false, mirror: true:');
console.log(
  'await $`echo "Shown but not captured"`.start({ capture: false, mirror: true })'
);
const result = await $`echo "Shown but not captured"`.start({
  capture: false,
  mirror: true,
});
console.log(`Console output: YES (you saw it above)`);
console.log(`Captured: ${JSON.stringify(result.stdout)}`);
