#!/usr/bin/env node
// Test the trace option in $ config

import { $ } from '../js/src/$.mjs';

console.log('=== Test: mirror:false with trace:false in CI environment ===');
process.env.CI = 'true';

const $silent = $({ mirror: false, capture: true, trace: false });
const result = await $silent`echo '{"status":"ok"}'`;
console.log('JSON Output:', result.stdout);

console.log('\n=== Parsing JSON to verify it works ===');
try {
  const parsed = JSON.parse(result.stdout);
  console.log('Parsed successfully:', parsed);
  console.log('✓ Test PASSED: No trace logs interfered with JSON parsing');
} catch (e) {
  console.error('✗ Test FAILED: Could not parse JSON:', e.message);
  console.error('Raw output:', result.stdout);
}
