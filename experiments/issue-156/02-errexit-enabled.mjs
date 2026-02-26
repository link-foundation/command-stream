#!/usr/bin/env bun
/**
 * Experiment 2: Enabling errexit (set -e equivalent)
 *
 * Demonstrates how shell.errexit(true) changes behavior to throw exceptions
 * on non-zero exit codes — like bash with "set -e".
 *
 * Related: https://github.com/link-foundation/command-stream/issues/156
 */

import { $, shell, set, unset } from '../../js/src/$.mjs';

console.log('=== Experiment 2: Enabling errexit ===\n');

// Reset to defaults first
shell.errexit(false);

// 1. Method 1: shell.errexit(true)
console.log('--- Method 1: shell.errexit(true) ---');
shell.errexit(true);
console.log('Settings after shell.errexit(true):', shell.settings());

try {
  await $`false`;
  console.log('❌ Should not reach here');
} catch (err) {
  console.log('✅ Exception thrown as expected');
  console.log('   err.message:', err.message);
  console.log('   err.code:', err.code);
  console.log('   err.stdout:', JSON.stringify(err.stdout));
  console.log('   err.stderr:', JSON.stringify(err.stderr));
  console.log('   err.result:', err.result);
}

// Reset
shell.errexit(false);
console.log();

// 2. Method 2: set('e')
console.log('--- Method 2: set("e") ---');
set('e');
console.log('Settings after set("e"):', shell.settings());

try {
  await $`false`;
  console.log('❌ Should not reach here');
} catch (err) {
  console.log('✅ Exception thrown via set("e")');
  console.log('   exit code:', err.code);
}

// Disable
unset('e');
console.log('Settings after unset("e"):', shell.settings());
console.log();

// 3. Method 3: Full option name
console.log('--- Method 3: set("errexit") ---');
set('errexit');
console.log('Settings after set("errexit"):', shell.settings());
try {
  await $`false`;
} catch (err) {
  console.log('✅ Exception thrown via set("errexit"):', err.code);
}
unset('errexit');
console.log();

// 4. Demonstrate the try/catch WORKS with errexit=true
console.log('--- try/catch WORKS with errexit=true ---');
shell.errexit(true);

try {
  // This is the git diff equivalent from calculator issue #78
  await $`false`; // exit code 1 = changes present
  console.log('No changes — exit code was 0');
} catch (err) {
  if (err.code === 1) {
    console.log('✅ Changes detected (exit code 1) — catch block correctly reached');
    console.log('   This is the CORRECT way to use try/catch with command-stream');
  }
}

shell.errexit(false);
console.log();

// 5. Mixed mode: strict for critical ops, relaxed for detection
console.log('--- Mixed mode: strict/relaxed pattern ---');
shell.errexit(true); // Start strict

// Temporarily relax for a detection command
shell.errexit(false);
const diff = await $`false`; // Simulates: git diff --cached --quiet
shell.errexit(true);          // Back to strict

if (diff.code !== 0) {
  console.log('✅ Changes detected via explicit code check (code:', diff.code + ')');
  console.log('   Proceeding with commit...');
  // await $`git commit -m "Release"`;  // Would proceed here
} else {
  console.log('No changes to commit');
}

shell.errexit(false);
console.log('\n=== All experiments completed ===');
