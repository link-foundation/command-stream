#!/usr/bin/env node

// Performance optimization - disable capture

import { $ } from '../js/src/$.mjs';

console.log('Performance optimization - disable capture:');
console.log('await $`echo "fast"`.start({ capture: false })');
const result = await $`echo "This runs fast without memory capture"`.start({
  capture: false,
});
console.log(
  `Exit code: ${result.code}, Stdout: ${JSON.stringify(result.stdout)}`
);
