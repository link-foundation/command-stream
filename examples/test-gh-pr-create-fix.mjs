#!/usr/bin/env node
// Test the fix with gh pr create command simulation

import { $ } from '../src/$.mjs';
import { needsRealShell } from '../src/shell-parser.mjs';

console.log('=== Testing gh pr create output capture fix ===\n');

// Since we can't actually create PRs, let's simulate gh pr create behavior
// gh pr create outputs the PR URL to stderr, not stdout

console.log('1. Checking needsRealShell behavior:');
const ghCommand = 'gh pr create --title "test" --body "test"';
console.log(`  Command: ${ghCommand}`);
console.log(`  needsRealShell: ${needsRealShell(ghCommand)}`);

console.log('\n2. Simulating gh pr create stderr output:');
try {
  // This simulates how gh pr create actually behaves - it outputs URLs to stderr
  const result = await $`echo "https://github.com/link-foundation/command-stream/pull/123" >&2`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  
  if (result.stderr.includes('https://github.com')) {
    console.log('  ✅ SUCCESS: stderr correctly captured PR URL');
  } else {
    console.log('  ❌ FAIL: stderr did not capture PR URL');
  }
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n3. Testing with both stdout and stderr:');
try {
  // Simulate a command that outputs to both streams (like gh pr create might)
  const result = await $`echo "Creating pull request..." && echo "https://github.com/link-foundation/command-stream/pull/456" >&2`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  
  const hasProgressMessage = result.stdout.includes('Creating pull request');
  const hasPrUrl = result.stderr.includes('https://github.com');
  
  if (hasProgressMessage && hasPrUrl) {
    console.log('  ✅ SUCCESS: Both stdout progress and stderr URL captured');
  } else {
    console.log('  ❌ FAIL: Missing expected output');
  }
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n4. Testing workaround still works (2>&1):');
try {
  const result = await $`echo "https://github.com/link-foundation/command-stream/pull/789" >&2 2>&1`;
  console.log('  stdout with 2>&1:', JSON.stringify(result.stdout));
  console.log('  stderr with 2>&1:', JSON.stringify(result.stderr));
  
  if (result.stdout.includes('https://github.com') || result.stderr.includes('https://github.com')) {
    console.log('  ✅ SUCCESS: Workaround still works');
  } else {
    console.log('  ❌ FAIL: Workaround not working');
  }
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n=== Fix validation complete ===');