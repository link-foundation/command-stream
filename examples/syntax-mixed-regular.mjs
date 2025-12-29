#!/usr/bin/env node

// Mixed with regular $ verification

import { $ } from '../js/src/$.mjs';

console.log('Verifying mixed with regular $...');

const result = await $`echo "normal"`;
console.assert(result.stdout === 'normal\n', 'Regular $ failed');
console.log('✓ Regular $ still works');
