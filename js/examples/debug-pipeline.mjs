#!/usr/bin/env bun

import { $ } from '../src/$.mjs';

console.log('=== Debug Pipeline Selection ===\n');

// Add debug output to see which pipeline method is being used
const originalRunPipeline = $.prototype._runPipeline;

// Simple test
console.log('Testing: echo "test" | cat');
const cmd = $`echo "test" | cat`;
const result = await cmd;
console.log('Result:', result.stdout);
