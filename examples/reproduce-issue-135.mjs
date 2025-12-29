#!/usr/bin/env node
// Reproducing issue #135: Trace logs interfere with output when CI=true

import { $ } from '../js/src/$.mjs';

const $silent = $({ mirror: false, capture: true });

console.log('=== Test 1: Without CI environment ===');
const result1 = await $silent`echo '{"status":"ok"}'`;
console.log('Output:', result1.stdout || result1);

console.log('\n=== Test 2: With CI=true environment ===');
process.env.CI = 'true';
const result2 = await $silent`echo '{"status":"ok"}'`;
console.log('Output:', result2.stdout || result2);

console.log('\n=== Expected: Both outputs should be just {"status":"ok"} ===');
