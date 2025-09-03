#!/usr/bin/env node

// Test: User provides double quotes around interpolated value
// Expected: Preserve double quotes (wrapped in single quotes for shell)

import { $ } from '../src/$.mjs';

const claude = '/Users/konard/.claude/local/claude';

console.log('=== Test: User-Provided Double Quotes ===\n');

// User wraps the path in double quotes
const doubleQuoted = `"${claude}"`;

console.log('Original path:', claude);
console.log('User provides:', doubleQuoted);

const cmd = $({ mirror: false })`${doubleQuoted} --version`;
console.log('Generated command:', cmd.spec.command);

// Check the expected result
const expected = `'"/Users/konard/.claude/local/claude"' --version`;
if (cmd.spec.command === expected) {
  console.log('✅ PASS: Double quotes preserved and properly wrapped');
} else {
  console.log('❌ FAIL: Unexpected quoting');
  console.log('Expected:', expected);
}

// Test execution
try {
  const result = await cmd;
  console.log('\nExecution result:', result.code);
} catch (error) {
  console.log('\nExecution error:', error.message);
}