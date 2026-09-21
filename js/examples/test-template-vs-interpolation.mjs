#!/usr/bin/env node

// Test the difference between template literals and string interpolation
import { $ } from '../src/$.mjs';

// Enable verbose mode
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('=== Template Literal vs String Interpolation Test ===');
console.log(
  `Runtime: ${typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js'}`
);

console.log('\n--- Testing Template Literal: $`echo hello` ---');
try {
  const result1 = await $`echo hello`;
  console.log(
    `✓ Template literal success: "${result1.stdout.toString().trim()}"`
  );
} catch (error) {
  console.log(`✗ Template literal failed: ${error.message}`);
}

console.log('\n--- Testing String Interpolation: $`${cmd}` ---');
const cmd = 'echo hello';
try {
  const result2 = await $`${cmd}`;
  console.log(
    `✓ String interpolation success: "${result2.stdout.toString().trim()}"`
  );
} catch (error) {
  console.log(`✗ String interpolation failed: ${error.message}`);
  if (error.stderr) {
    console.log(`  Stderr: ${error.stderr.toString().trim()}`);
  }
}

console.log('\n--- Testing another format: $(cmd) ---');
try {
  // Note: This tests using a variable directly in template literal
  const result3 = $`${cmd}`;
  const output3 = await result3;
  console.log(`✓ $(cmd) format success: "${output3.stdout.toString().trim()}"`);
} catch (error) {
  console.log(`✗ $(cmd) format failed: ${error.message}`);
  if (error.stderr) {
    console.log(`  Stderr: ${error.stderr.toString().trim()}`);
  }
}
