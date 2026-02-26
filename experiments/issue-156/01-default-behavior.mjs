#!/usr/bin/env bun
/**
 * Experiment 1: Default errexit behavior in command-stream
 *
 * Demonstrates that command-stream defaults to errexit=false (like bash without set -e),
 * meaning failed commands do NOT throw exceptions by default.
 *
 * Related: https://github.com/link-foundation/command-stream/issues/156
 */

import { $, shell } from '../../js/src/$.mjs';

console.log('=== Experiment 1: Default errexit behavior ===\n');

// 1. Verify default settings
const settings = shell.settings();
console.log('Default shell settings:', settings);
console.log('errexit is:', settings.errexit, '(should be false)\n');

// 2. Run a failing command — should NOT throw
console.log('--- Test: running "false" (exit code 1) with default settings ---');
try {
  const result = await $`false`;
  console.log('✅ No exception thrown (errexit=false default)');
  console.log('   result.code:', result.code);
  console.log('   Script continued after failure\n');
} catch (err) {
  console.log('❌ Unexpected exception thrown:', err.message);
}

// 3. Demonstrate the anti-pattern from calculator issue #78
console.log('--- Anti-pattern: try/catch for exit code detection ---');
console.log('This pattern FAILS silently because errexit=false:');
let catchReached = false;
try {
  await $`false`; // exit code 1 — does NOT throw
  console.log('❌ "No changes to commit" — always prints (BUG)');
} catch {
  catchReached = true;
  console.log('✅ catch block reached (only with errexit=true)');
}
if (!catchReached) {
  console.log('   Catch block was NEVER reached — this is the bug!\n');
}

// 4. The CORRECT pattern: explicit exit code check
console.log('--- Correct pattern: explicit exit code check ---');
const result = await $`false`;
if (result.code !== 0) {
  console.log('✅ Correctly detected non-zero exit code:', result.code);
} else {
  console.log('No changes to commit (would only print on code 0)');
}
console.log();

// 5. Demonstrate that multiple commands all execute despite failures
console.log('--- Multiple commands with failures (errexit=false) ---');
const r1 = await $`false`;
const r2 = await $`echo "still running"`;
const r3 = await $`false`;
const r4 = await $`echo "also running"`;
console.log('All 4 commands executed. Exit codes:', r1.code, r2.code, r3.code, r4.code);
console.log('(bash without set -e behaves the same way)\n');
