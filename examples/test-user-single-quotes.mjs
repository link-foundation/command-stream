#!/usr/bin/env node

// Test: User provides single quotes around interpolated value
// Expected: Preserve single quotes without double-escaping

import { $ } from '../src/$.mjs';

const claude = '/Users/konard/.claude/local/claude';

console.log('=== Test: User-Provided Single Quotes ===\n');

// User wraps the path in single quotes
const singleQuoted = `'${claude}'`;

console.log('Original path:', claude);
console.log('User provides:', singleQuoted);

const cmd = $({ mirror: false })`${singleQuoted} --version`;
console.log('Generated command:', cmd.spec.command);

// Check the result
if (cmd.spec.command === `'${claude}' --version`) {
  console.log('✅ PASS: Single quotes preserved correctly');
} else if (cmd.spec.command.includes("''")) {
  console.log('❌ FAIL: Double quotes detected');
} else {
  console.log('⚠️  WARNING: Unexpected quoting pattern');
}

// Test execution
try {
  const result = await cmd;
  console.log('\nExecution result:', result.code);
} catch (error) {
  console.log('\nExecution error:', error.message);
}