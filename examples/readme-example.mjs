#!/usr/bin/env node

import { $, register } from '../$.mjs';

// Register a custom virtual command with the new object-based signature
register('greet', async ({ args, stdin }) => {
  return { stdout: `Hello, ${stdin.trim()}!\n`, code: 0 };
});

// Example usage: echo "World" | greet
console.log('Running: echo "World" | greet');
const result = await $`echo "World"`.pipe($`greet`);
console.log('Result:', result.stdout.trim());

// Example with args
register('greet-formal', async ({ args, stdin }) => {
  const title = args[0] || '';
  return { stdout: `Hello, ${title} ${stdin.trim()}!\n`, code: 0 };
});

console.log('\nRunning: echo "Smith" | greet-formal Mr.');
const result2 = await $`echo "Smith"`.pipe($`greet-formal Mr.`);
console.log('Result:', result2.stdout.trim());

// Example accessing other options
register('debug', async ({ args, stdin, mirror, capture }) => {
  const info = {
    args: args,
    stdinLength: stdin ? stdin.length : 0,
    mirror: mirror,
    capture: capture
  };
  return { stdout: JSON.stringify(info, null, 2) + '\n', code: 0 };
});

console.log('\nRunning: echo "test input" | debug arg1 arg2');
const result3 = await $`echo "test input"`.pipe($`debug arg1 arg2`);
console.log('Result:', result3.stdout.trim());