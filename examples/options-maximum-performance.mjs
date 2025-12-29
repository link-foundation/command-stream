#!/usr/bin/env node

// Maximum performance - no capture, no mirror

import { $ } from '../js/src/$.mjs';

console.log('Maximum performance - no capture, no mirror:');
console.log('await $`echo "blazing"`.start({ capture: false, mirror: false })');
const result = await $`echo "This is blazing fast!"`.start({
  capture: false,
  mirror: false,
});
console.log(
  `Exit code: ${result.code}, Stdout: ${JSON.stringify(result.stdout)}`
);
