#!/usr/bin/env node
// Comprehensive test for issue #135: Trace logs interfere with output

import { $ } from '../src/$.mjs';

console.log('=== Test 1: Default (no env vars, mirror:false, capture:true) ===');
const $silent = $({ mirror: false, capture: true });
const result1 = await $silent`echo test1`;
console.log('Output:', result1.stdout);
console.log('Expected: just "test1"\n');

console.log('=== Test 2: CI=true (should NOT produce trace logs) ===');
process.env.CI = 'true';
const $silent2 = $({ mirror: false, capture: true });
const result2 = await $silent2`echo test2`;
console.log('Output:', result2.stdout);
console.log('Expected: just "test2"\n');

console.log('=== Test 3: CI=true + COMMAND_STREAM_TRACE=true (should produce trace logs) ===');
process.env.COMMAND_STREAM_TRACE = 'true';
const $silent3 = $({ mirror: false, capture: true });
const result3 = await $silent3`echo test3`;
console.log('Output:', result3.stdout);
console.log('Expected: "test3" (trace logs should appear in stderr above)\n');

console.log('=== Test 4: COMMAND_STREAM_TRACE=false overrides COMMAND_STREAM_VERBOSE=true ===');
process.env.COMMAND_STREAM_VERBOSE = 'true';
process.env.COMMAND_STREAM_TRACE = 'false';
const result4 = await $silent`echo test4`;
console.log('Output:', result4.stdout);
console.log('Expected: just "test4" (no trace logs even though VERBOSE=true)\n');

console.log('=== All tests completed ===');
