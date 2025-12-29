#!/usr/bin/env node

// Exact test for issue #12 from deep-assistant/hive-mind
// Original issue: https://github.com/link-foundation/command-stream/issues/12
// Original error: ENOENT: no such file or directory, posix_spawn ''/Users/konard/.claude/local/claude''

import { $ } from '../src/$.mjs';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('Testing exact issue #12 scenario:');
console.log('Path:', claude);
console.log();

// This is the exact failing line from the original issue
try {
  const result =
    await $`${claude} -p "hi" --output-format stream-json --model sonnet | jq .`;
  console.log('Success! Result:', result.stdout);
} catch (error) {
  console.log('Error message:', error.message);
  console.log();

  // Check if the error contains the problematic double quotes
  if (error.message.includes("''") && error.message.includes('posix_spawn')) {
    console.log('❌ BUG STILL PRESENT: Double quotes in posix_spawn error');
  } else if (error.message.includes('posix_spawn')) {
    console.log('⚠️  posix_spawn error but no double quotes - partial fix');
  } else {
    console.log('✅ BUG FIXED: No double quotes in error message');
    console.log('   Error is now properly formatted');
  }
}
