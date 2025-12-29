#!/usr/bin/env node
// Reproducing issue #135: Trace logs interfere with output when CI=true
// This test sets CI=true BEFORE importing the module

process.env.CI = 'true';

import { $ } from '../js/src/$.mjs';

console.log('=== Test with CI=true set BEFORE import ===');
const $silent = $({ mirror: false, capture: true });
const result = await $silent`echo '{"status":"ok"}'`;
console.log('Output:', result.stdout || result);
console.log(
  '\n=== Expected: Should be just {"status":"ok"} without trace logs ==='
);
