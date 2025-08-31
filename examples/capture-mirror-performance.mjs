#!/usr/bin/env node

// capture: false, mirror: false (maximum performance)

import { $ } from '../src/$.mjs';

console.log('capture: false, mirror: false:');
console.log('await $`echo "Neither shown nor captured"`.start({ capture: false, mirror: false })');
const result = await $`echo "Neither shown nor captured"`.start({ capture: false, mirror: false });
console.log(`Console output: NO (you didn't see it)`);
console.log(`Captured: ${JSON.stringify(result.stdout)}`);