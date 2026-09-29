#!/usr/bin/env bun
/**
 * Experiment 4: Reproducing the calculator issue #78 bug
 *
 * Demonstrates exactly what happened in link-assistant/calculator's
 * version-and-commit.mjs script.
 *
 * The bug: try/catch was used to detect git diff exit code 1,
 * but command-stream defaults to errexit=false, so the catch was never reached.
 *
 * Related: https://github.com/link-foundation/command-stream/issues/156
 *          https://github.com/link-assistant/calculator/pull/79
 */

import { $, shell } from '../../js/src/$.mjs';

console.log('=== Experiment 4: Calculator Bug Reproduction ===\n');

// Simulate the state: there are staged changes
// We use `false` to simulate `git diff --cached --quiet` exiting with code 1
// (exit code 1 = staged changes exist, exit code 0 = no staged changes)

// =============================================================
// BUGGY VERSION (what calculator had before PR #79)
// =============================================================
console.log('--- BUGGY VERSION (from calculator before PR #79) ---');
console.log('shell.errexit:', shell.settings().errexit, '(false by default)\n');

let commitAttempted = false;

// This is the exact buggy pattern:
try {
  await $`false`; // Simulates: git diff --cached --quiet (returns 1 = changes exist)
  // NEVER should reach here when exit code is 1
  // BUT with errexit=false, no exception is thrown!
  console.log('No changes to commit'); // ← Always executes! BUG!
  // return;  // ← Would return early here, skipping the commit
} catch {
  // Intended: only run when staged changes exist (exit code 1)
  // Actual: NEVER reached with errexit=false
  commitAttempted = true;
  console.log('Caught: changes detected — would commit');
}

if (!commitAttempted) {
  console.log('');
  console.log('💥 BUG REPRODUCED: catch block never reached!');
  console.log('   Auto-release pipeline exits without committing.');
  console.log('   This is why 37 changelog fragments accumulated.');
  console.log('   CI log showed: "No changes to commit" every single run.');
}

console.log(`\n${'='.repeat(60)}\n`);

// =============================================================
// FIXED VERSION (what calculator has after PR #79)
// =============================================================
console.log('--- FIXED VERSION (after PR #79) ---');

// Explicit exit code check — no try/catch needed
const diffResult = await $`false`; // Simulates: git diff --cached --quiet
if (diffResult.code === 0) {
  console.log('No changes to commit');
  // process.exit(0);
} else {
  // diffResult.code === 1: staged changes exist
  console.log('✅ Changes detected (exit code:', `${diffResult.code})`);
  console.log('   Proceeding with git commit...');
  // await $`git commit -m "Automated version bump"`;
  console.log('   Commit would be made here.');
}

console.log(`\n${'='.repeat(60)}\n`);

// =============================================================
// ALTERNATIVE FIX: Use errexit=true
// =============================================================
console.log('--- ALTERNATIVE FIX: Enable errexit=true ---');

shell.errexit(true);

try {
  await $`false`; // Now throws because errexit=true
  console.log('No changes to commit'); // Would NOT reach here
} catch (err) {
  if (err.code === 1) {
    console.log('✅ Changes detected via exception (code:', `${err.code})`);
    console.log('   Proceeding with git commit...');
    // await $`git commit -m "Automated version bump"`;
    console.log('   Commit would be made here.');
  }
}

shell.errexit(false); // Reset

console.log('\n=== Reproduction complete ===');
console.log('\nConclusion:');
console.log(
  '- The bug was a try/catch used with the assumption that errexit=true'
);
console.log(
  '- command-stream defaults to errexit=false (like bash without set -e)'
);
console.log('- Fix: use explicit result.code check instead of try/catch');
console.log('- Or: enable shell.errexit(true) before using try/catch pattern');
