#!/usr/bin/env node

// Debug execution path to see exactly what's happening
import { $ } from '../src/$.mjs';

// Enable verbose mode to see detailed tracing
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('=== Execution Path Debug ===');
console.log(
  `Runtime: ${typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js'}`
);

console.log('\n--- Testing simple command: echo hello ---');

try {
  const result = await $`echo hello`;
  console.log(`✓ Success: "${result.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ Failed: ${error.message}`);
  if (error.code) {
    console.log(`  Code: ${error.code}`);
  }
  if (error.stderr) {
    console.log(`  Stderr: ${error.stderr.toString().trim()}`);
  }
}
