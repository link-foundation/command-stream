#!/usr/bin/env node
/**
 * Test the new literal() function for preserving apostrophes
 */

import { $, literal, quoteLiteral } from '../js/src/$.mjs';
import fs from 'fs/promises';

console.log('=== Testing literal() Function ===\n');

// Test cases from the issue
const testCases = [
  { input: "didn't", description: 'Basic apostrophe' },
  { input: "it's user's choice", description: 'Multiple apostrophes' },
  { input: 'text is "quoted"', description: 'Double quotes' },
  { input: 'it\'s "great"', description: 'Mixed quotes' },
  { input: 'use `npm install`', description: 'Backticks' },
  { input: 'Line 1\nLine 2', description: 'Newlines' },
  { input: 'price is $100', description: 'Dollar sign' },
  { input: 'path\\to\\file', description: 'Backslashes' },
];

// Create a script that echoes its arguments exactly
const scriptPath = '/tmp/show-args.sh';
await fs.writeFile(
  scriptPath,
  `#!/bin/bash
for arg in "$@"; do
    echo "$arg"
done
`
);
await fs.chmod(scriptPath, '755');

console.log('Testing quoteLiteral() function directly:\n');
for (const { input, description } of testCases) {
  const quoted = quoteLiteral(input);
  console.log(`${description}:`);
  console.log(`  Input:  "${input}"`);
  console.log(`  Quoted: ${quoted}`);
  console.log('');
}

console.log('\n=== Testing with shell execution ===\n');

let passCount = 0;
let failCount = 0;

for (const { input, description } of testCases) {
  console.log(`--- ${description} ---`);
  console.log(`Input: "${input.replace(/\n/g, '\\n')}"`);

  try {
    // Test with literal() function
    const result = await $`/tmp/show-args.sh ${literal(input)}`.run({
      capture: true,
      mirror: false,
    });

    const output = result.stdout.trim();
    const matches = output === input;

    console.log(`Output: "${output.replace(/\n/g, '\\n')}"`);
    console.log(`Match: ${matches ? '✅ PASS' : '❌ FAIL'}`);

    if (matches) {
      passCount++;
    } else {
      failCount++;
      console.log(`Expected: "${input.replace(/\n/g, '\\n')}"`);
      console.log(`Got:      "${output.replace(/\n/g, '\\n')}"`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
    failCount++;
  }

  console.log('');
}

// Cleanup
await fs.unlink(scriptPath);

console.log('=== Summary ===');
console.log(`Passed: ${passCount}/${testCases.length}`);
console.log(`Failed: ${failCount}/${testCases.length}`);

// Compare with regular quote() behavior
console.log('\n=== Comparison: quote() vs literal() ===\n');

const comparisonText = "Dependencies didn't exist";
console.log(`Text: "${comparisonText}"`);

// Create script again for comparison
await fs.writeFile(
  scriptPath,
  `#!/bin/bash
for arg in "$@"; do
    echo "$arg"
done
`
);
await fs.chmod(scriptPath, '755');

const regularResult = await $`/tmp/show-args.sh ${comparisonText}`.run({
  capture: true,
  mirror: false,
});
console.log(`\nWith regular quote() (default):`);
console.log(`  Result: "${regularResult.stdout.trim()}"`);

const literalResult = await $`/tmp/show-args.sh ${literal(comparisonText)}`.run(
  {
    capture: true,
    mirror: false,
  }
);
console.log(`\nWith literal():`);
console.log(`  Result: "${literalResult.stdout.trim()}"`);

await fs.unlink(scriptPath);

process.exit(failCount > 0 ? 1 : 0);
