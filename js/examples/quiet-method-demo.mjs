#!/usr/bin/env node

/**
 * Demonstration of the .quiet() method
 * Similar to zx's .quiet() functionality
 *
 * This example shows how .quiet() suppresses console output
 * while still capturing the command's stdout/stderr
 */

import { $ } from '../src/$.mjs';

console.log('=== Example 1: Without .quiet() - output is shown ===');
const result1 = await $`echo "This will be printed to console"`;
console.log('Captured stdout:', result1.stdout.trim());
console.log('');

console.log('=== Example 2: With .quiet() - output is suppressed ===');
const result2 = await $`echo "This will NOT be printed to console"`.quiet();
console.log('Captured stdout:', result2.stdout.trim());
console.log('');

console.log('=== Example 3: Similar to the issue example ===');
// This simulates the use case from the issue:
// await $`gh api gists/${gistId} --jq '{owner: .owner.login, files: .files, history: .history}'`.quiet();

// Using a simple command instead of gh api for demonstration
const jsonData = JSON.stringify({
  owner: 'test-user',
  files: { 'file.txt': { content: 'Hello World' } },
  history: []
});

const result3 = await $`echo ${jsonData}`.quiet();
const parsed = JSON.parse(result3.stdout.trim());
console.log('Parsed data (without console noise):', parsed);
console.log('');

console.log('=== Example 4: Chaining with other methods ===');
const result4 = await $`echo "Line 1\nLine 2\nLine 3"`.quiet();
console.log('Lines captured:', result4.stdout.split('\n').length);
console.log('');

console.log('=== All examples completed successfully! ===');
