#!/usr/bin/env node
/**
 * Experiment to test apostrophe escaping issue (#141)
 *
 * This script demonstrates the problem:
 * - Apostrophes in text are escaped using Bash's '\'' pattern
 * - When the text is passed to APIs that store it literally, the escape sequence appears
 * - Result: "didn't" becomes "didn'''t"
 */

import { $, raw } from '../js/src/$.mjs';

console.log('=== Apostrophe Escaping Issue (#141) ===\n');

// Test cases from the issue
const testCases = [
  { input: "didn't", description: 'Basic apostrophe' },
  { input: "it's user's choice", description: 'Multiple apostrophes' },
  { input: 'text is "quoted"', description: 'Double quotes' },
  { input: "it's \"great\"", description: 'Mixed quotes' },
  { input: "use `npm install`", description: 'Backticks' },
  { input: "Line 1\nLine 2", description: 'Newlines' },
];

console.log('Testing echo command with interpolated text:\n');

for (const { input, description } of testCases) {
  console.log(`--- ${description} ---`);
  console.log(`Input:    "${input}"`);

  try {
    // Test with standard interpolation (shows the escaping issue)
    const result = await $`echo "${input}"`.run({ capture: true, mirror: false });
    console.log(`Output:   "${result.stdout.trim()}"`);

    // Check if output matches input
    const matches = result.stdout.trim() === input;
    console.log(`Matches:  ${matches ? '✅ YES' : '❌ NO'}`);

    if (!matches) {
      console.log(`Expected: "${input}"`);
      console.log(`Got:      "${result.stdout.trim()}"`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }

  console.log('');
}

// Now let's see what the actual shell command looks like
console.log('\n=== Internal Command Analysis ===\n');

// We can trace to see the actual command being built
const testText = "didn't exist";
console.log(`Test text: "${testText}"`);

// Check what happens with different quoting approaches
console.log('\n--- Using double-quoted template literal: $`echo "${text}"` ---');
const result1 = await $`echo "${testText}"`.run({ capture: true, mirror: false });
console.log(`Result: "${result1.stdout.trim()}"`);

console.log('\n--- Using raw(): $`echo ${raw(text)}` ---');
const result2 = await $`echo ${raw(testText)}`.run({ capture: true, mirror: false });
console.log(`Result: "${result2.stdout.trim()}"`);

console.log('\n--- Using plain interpolation: $`echo ${text}` ---');
const result3 = await $`echo ${testText}`.run({ capture: true, mirror: false });
console.log(`Result: "${result3.stdout.trim()}"`);

console.log('\n=== Summary ===\n');
console.log('The issue occurs because:');
console.log('1. Text with apostrophes is passed to command-stream');
console.log("2. command-stream uses single-quote escaping: ' → '\\''");
console.log('3. The shell correctly interprets this for echo');
console.log('4. But when passed to APIs (like gh CLI), the API receives/stores');
console.log('   the escaped form, not the interpreted result');
console.log('\nWorkaround: Use stdin with JSON for API calls (see issue for details)');
