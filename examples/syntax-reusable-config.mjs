#!/usr/bin/env node

// Multiple uses of same configured $ verification

import { $ } from '../src/$.mjs';

console.log('Verifying reusable configurations...');

const $multi = $({ capture: true, mirror: false });
const result1 = await $multi`echo "1"`;
const result2 = await $multi`echo "2"`;
console.assert(result1.stdout === '1\n' && result2.stdout === '2\n', 'Reuse failed');
console.log('✓ Reusable configurations work');