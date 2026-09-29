#!/usr/bin/env node

// EXACT reproduction of issue #12 from deep-assistant/hive-mind
// Original file: https://github.com/deep-assistant/hive-mind/blob/ff005fa5/claude-pipe/test-pipe.mjs
// Issue: https://github.com/link-foundation/command-stream/issues/12
// Error: ENOENT: no such file or directory, posix_spawn ''/Users/konard/.claude/local/claude''

import { $ } from '../src/$.mjs';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Reproducing Issue #12: Path with quotes in posix_spawn ===\n');
console.log('Using path:', claude);
console.log();

async function reproduceOriginalIssue() {
  console.log('1. EXACT CODE FROM ISSUE (test-pipe.mjs):');
  console.log('------------------------------------------');

  try {
    // This is the EXACT line that was failing
    const result =
      await $`${claude} -p "hi" --output-format stream-json --model sonnet | jq .`;
    console.log('Result:');
    console.log(result.stdout);
  } catch (error) {
    console.error('❌ Error reproduced:', error.message);

    // Check if this is the exact error from the issue
    if (error.message.includes("''") && error.message.includes('ENOENT')) {
      console.log('\n✓ THIS IS THE EXACT ERROR FROM ISSUE #12!');
      console.log("  The path has extra quotes: ''...''");
    }
  }
}

async function testSimplifiedCase() {
  console.log('\n2. SIMPLIFIED TEST CASE:');
  console.log('------------------------');

  try {
    // Simplify to just the command without pipe
    console.log(`Trying: ${claude} --version`);
    const result = await $`${claude} --version`;
    console.log('Result:', result);
  } catch (error) {
    console.error('❌ Error:', error.message);

    if (error.message.includes("''")) {
      console.log('✓ Double quotes still present in error!');
    }
  }
}

async function testQuotingPatterns() {
  console.log('\n3. TESTING QUOTE PATTERNS:');
  console.log('---------------------------');

  // Test what happens with already-quoted paths
  const patterns = [
    { desc: 'Plain path', path: claude },
    { desc: 'Single-quoted', path: `'${claude}'` },
    { desc: 'Double-quoted', path: `"${claude}"` },
  ];

  for (const { desc, path } of patterns) {
    console.log(`\n${desc}: ${path}`);
    try {
      // Use echo to avoid actual execution
      const result = await $`echo "Would execute: ${path}"`;
      console.log('Echo result:', String(result).trim());
    } catch (error) {
      console.error('Error:', error.message);
    }
  }
}

async function showWorkingPattern() {
  console.log('\n4. CORRECT PATTERN (should work):');
  console.log('----------------------------------');

  try {
    // Using a valid command to show proper interpolation
    const testCmd = 'echo';
    const args = `"Testing path: ${claude}"`;
    console.log(`Command: ${testCmd} ${args}`);

    const result = await $`${testCmd} ${args}`;
    console.log('✓ Result:', String(result).trim());
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run all tests
(async () => {
  await reproduceOriginalIssue();
  await testSimplifiedCase();
  await testQuotingPatterns();
  await showWorkingPattern();
})().catch(console.error);
