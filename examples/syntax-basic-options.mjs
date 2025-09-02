#!/usr/bin/env node

// Basic options verification

import { $ } from '../src/$.mjs';

console.log('Verifying basic options...');

const $quiet = $({ mirror: false });
const result = await $quiet`echo "test"`;
console.assert(result.stdout === 'test\n', 'Basic options failed');
console.log('✓ Basic options work');