#!/usr/bin/env node

// Default behavior (capture: true, mirror: true)

import { $ } from '../js/src/$.mjs';

console.log('Default behavior (capture: true, mirror: true):');
console.log('await $`echo "Default: both enabled"`');
const result = await $`echo "Default: both enabled"`;
console.log(`Console output: YES (you saw it above)`);
console.log(`Captured: ${JSON.stringify(result.stdout)}`);
