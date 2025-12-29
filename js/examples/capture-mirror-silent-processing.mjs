#!/usr/bin/env node

// capture: true, mirror: false (silent data processing)

import { $ } from '../js/src/$.mjs';

console.log('capture: true, mirror: false:');
console.log(
  'await $`echo "Captured but silent"`.start({ capture: true, mirror: false })'
);
const result = await $`echo "Captured but silent"`.start({
  capture: true,
  mirror: false,
});
console.log(`Console output: NO (you didn't see it)`);
console.log(`Captured: ${JSON.stringify(result.stdout)}`);
