#!/usr/bin/env node

// Test the actual buildShellCommand from command-stream
import { $ } from '../js/src/$.mjs';

// Enable verbose to see buildShellCommand traces
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('=== Testing Actual buildShellCommand ===');

console.log('\n--- Case 1: $`echo hello` ---');
try {
  const result1 = await $`echo hello`;
  console.log(`✓ Result: "${result1.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ Error: ${error.message}`);
}

console.log('\n--- Case 2: $`${cmd}` where cmd="echo hello" ---');
const cmd = 'echo hello';
try {
  const result2 = await $`${cmd}`;
  console.log(`✓ Result: "${result2.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ Error: ${error.message}`);
}

console.log('\n--- Case 3: $`echo ${arg}` where arg="hello" ---');
const arg = 'hello';
try {
  const result3 = await $`echo ${arg}`;
  console.log(`✓ Result: "${result3.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ Error: ${error.message}`);
}

console.log('\n--- Case 4: Pipeline $`${pipeline}` ---');
const pipeline = 'echo hello | wc -w';
try {
  const result4 = await $`${pipeline}`;
  console.log(`✓ Result: "${result4.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ Error: ${error.message}`);
}
