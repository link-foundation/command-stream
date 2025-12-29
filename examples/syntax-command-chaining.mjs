#!/usr/bin/env node

// Command chaining verification

import { $ } from '../js/src/$.mjs';

console.log('Verifying command chaining...');

const $chain = $({ mirror: false });
const result = await $chain`echo "abc" | tr 'a-z' 'A-Z'`;
console.assert(result.stdout === 'ABC\n', 'Chaining failed');
console.log('✓ Command chaining works');
