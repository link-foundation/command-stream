#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log("=== Testing the Double-Quoting Fix ===");

// Test the exact case from the GitHub issue
const arg = '"already quoted"';
console.log('Input:', arg);

const cmd = $({ mirror: false })`echo ${arg}`;
console.log('Generated command:', cmd.spec.command);
console.log('Expected: echo "already quoted"');
console.log('✅ Fixed double-quoting:', cmd.spec.command === 'echo "already quoted"');
console.log();

// Test additional cases to ensure we don't break existing functionality
const testCases = [
  {
    desc: "Double-quoted safe string",
    input: '"hello world"',
    expected: 'echo "hello world"',
  },
  {
    desc: "Double-quoted string with dollar sign (dangerous)",
    input: '"hello $USER"',
    expected: 'echo \'"hello $USER"\'', // Should be wrapped in single quotes
  },
  {
    desc: "Double-quoted string with backtick (dangerous)", 
    input: '"hello `date`"',
    expected: 'echo \'"hello `date`"\'', // Should be wrapped in single quotes
  },
  {
    desc: "Double-quoted string with backslash (dangerous)",
    input: '"hello\\nworld"',
    expected: 'echo \'"hello\\nworld"\'', // Should be wrapped in single quotes
  },
  {
    desc: "Single-quoted string (should stay as-is)",
    input: "'hello world'",
    expected: "echo 'hello world'",
  },
  {
    desc: "Unquoted safe string",
    input: "hello",
    expected: "echo hello",
  },
  {
    desc: "Unquoted unsafe string",
    input: "hello world",
    expected: "echo 'hello world'",
  }
];

console.log("=== Additional Test Cases ===");
testCases.forEach(({ desc, input, expected }, index) => {
  const testCmd = $({ mirror: false })`echo ${input}`;
  const result = testCmd.spec.command;
  const matches = result === expected;
  
  console.log(`${index + 1}. ${desc}:`);
  console.log(`   Input: ${JSON.stringify(input)}`);
  console.log(`   Generated: ${result}`);
  console.log(`   Expected:  ${expected}`);
  console.log(`   ${matches ? '✅' : '❌'} ${matches ? 'PASS' : 'FAIL'}`);
  console.log();
});