#!/usr/bin/env node

// Test script that reads the module code from stdin
// This avoids ES module import issues in CI

console.error('[test-sleep-stdin] Process started, PID:', process.pid);
console.error('[test-sleep-stdin] Node version:', process.version);

// Read the module code to eval from stdin
let moduleCode = '';
process.stdin.on('data', (chunk) => {
  moduleCode += chunk.toString();
});

process.stdin.on('end', async () => {
  try {
    console.error('[test-sleep-stdin] Evaluating module code...');
    // Create an async function to evaluate the code
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const runTest = new AsyncFunction('require', 'process', moduleCode);
    await runTest(require, process);
  } catch (error) {
    console.error('[test-sleep-stdin] Error:', error.message);
    console.log('STARTING_SLEEP'); // Still output for test
    process.exit(1);
  }
});