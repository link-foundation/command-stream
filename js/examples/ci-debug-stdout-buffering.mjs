#!/usr/bin/env node

/**
 * Example: Debugging stdout buffering issues in CI environments
 *
 * Problem: In CI environments (non-TTY), stdout is often buffered, causing
 * output to not appear immediately. This can make tests fail when they expect
 * immediate output.
 *
 * Solution: Force stdout flush in non-TTY environments.
 */

import { $ } from '../src/$.mjs';

console.log('Testing stdout buffering in CI environment');
console.log('Is TTY?', process.stdout.isTTY);

// Example 1: Force flush in non-TTY environment
async function testWithFlush() {
  console.log('TEST 1: With stdout flush');

  // Write and immediately flush
  process.stdout.write('IMMEDIATE_OUTPUT\n');

  // Force flush if not TTY (CI environment)
  if (!process.stdout.isTTY && process.stdout.write('', () => {})) {
    // This forces a flush
  }

  // Small delay to demonstrate the difference
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('After delay');
}

// Example 2: Using command-stream with proper output handling
async function testCommandStream() {
  console.log('\nTEST 2: Using command-stream');

  // This should handle output correctly in CI
  const result = await $`echo "COMMAND_OUTPUT"`;
  console.log('Result:', result.stdout);

  // For streaming output in CI
  const runner = $`echo "STREAMING_START" && sleep 0.1 && echo "STREAMING_END"`;

  for await (const chunk of runner.stream()) {
    process.stdout.write(`Chunk: ${chunk.data}`);
    // Force flush in CI
    if (!process.stdout.isTTY) {
      process.stdout.write('', () => {});
    }
  }
}

// Example 3: Debugging missing output in CI
async function debugMissingOutput() {
  console.log('\nTEST 3: Debugging missing output');

  // Add timestamps to understand timing
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ${msg}\n`;
    process.stderr.write(message); // stderr is often unbuffered
    process.stdout.write(message);

    // Force flush
    if (!process.stdout.isTTY) {
      process.stdout.write('', () => {});
    }
  };

  log('Starting test');
  log('Running command...');

  const result = await $`echo "TEST_OUTPUT"`;
  log(`Command completed with code ${result.code}`);
  log(`Output: ${result.stdout}`);
}

// Run tests
async function main() {
  try {
    await testWithFlush();
    await testCommandStream();
    await debugMissingOutput();

    console.log('\nAll tests completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
