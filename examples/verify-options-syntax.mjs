#!/usr/bin/env node

// Quick verification that $({ options }) syntax works correctly

import { $ } from '../src/$.mjs';

console.log('Verifying $({ options }) syntax...\n');

// Test 1: Basic options
const $quiet = $({ mirror: false });
const r1 = await $quiet`echo "test"`;
console.assert(r1.stdout === 'test\n', 'Basic options failed');
console.log('✓ Basic options work');

// Test 2: stdin option
const $stdin = $({ stdin: 'input\n' });
const r2 = await $stdin`cat`;
console.assert(r2.stdout === 'input\n', 'stdin option failed');
console.log('✓ stdin option works');

// Test 3: Mixed with regular $
const r3 = await $`echo "normal"`;
console.assert(r3.stdout === 'normal\n', 'Regular $ failed');
console.log('✓ Regular $ still works');

// Test 4: Chaining with new syntax
const $chain = $({ mirror: false });
const r4 = await $chain`echo "abc" | tr 'a-z' 'A-Z'`;
console.assert(r4.stdout === 'ABC\n', 'Chaining failed');
console.log('✓ Command chaining works');

// Test 5: Multiple uses of same configured $
const $multi = $({ capture: true, mirror: false });
const r5a = await $multi`echo "1"`;
const r5b = await $multi`echo "2"`;
console.assert(r5a.stdout === '1\n' && r5b.stdout === '2\n', 'Reuse failed');
console.log('✓ Reusable configurations work');

console.log('\n✅ All $({ options }) syntax tests passed!');