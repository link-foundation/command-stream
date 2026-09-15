#!/usr/bin/env bun

/**
 * Understanding how Unix tee command works
 * 
 * tee reads from stdin and writes to both stdout and files
 * - By default, tee overwrites output files
 * - With -a flag, tee appends to output files
 * - tee can handle multiple output files
 * - tee supports interactive mode (reads from stdin continuously)
 */

import { $ } from '../src/$.mjs';

console.log('=== Testing Unix tee behavior ===\n');

// Test 1: Basic tee with file output
console.log('Test 1: Basic tee functionality');
try {
  const result = await $`echo "Hello World" | tee test-output.txt`;
  console.log('stdout:', result.stdout);
  console.log('stderr:', result.stderr);
  console.log('code:', result.code);
  
  // Check if file was created
  const fileContent = await $`cat test-output.txt`.catch(() => ({ stdout: 'File not found' }));
  console.log('File content:', fileContent.stdout);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n---\n');

// Test 2: Interactive tee (if available)
console.log('Test 2: Does tee support interactive mode?');
try {
  // This should show that tee can work interactively
  console.log('Testing if tee supports interactive input...');
  console.log('(This would normally wait for user input)');
  
  // Instead of true interactive test, let's see what happens with stdin
  const interactiveTest = $({ stdin: "line 1\nline 2\nline 3\n" })`tee interactive-test.txt`;
  const result = await interactiveTest;
  console.log('Interactive result stdout:', result.stdout);
  
  const fileContent = await $`cat interactive-test.txt`.catch(() => ({ stdout: 'File not found' }));
  console.log('Interactive file content:', fileContent.stdout);
} catch (error) {
  console.log('Interactive test failed:', error.message);
}

console.log('\n---\n');

// Test 3: Multiple output files
console.log('Test 3: Multiple output files');
try {
  const result = await $`echo "Multiple files" | tee file1.txt file2.txt file3.txt`;
  console.log('Multiple files stdout:', result.stdout);
  
  console.log('Checking all files...');
  const file1 = await $`cat file1.txt`.catch(() => ({ stdout: 'File not found' }));
  const file2 = await $`cat file2.txt`.catch(() => ({ stdout: 'File not found' }));
  const file3 = await $`cat file3.txt`.catch(() => ({ stdout: 'File not found' }));
  
  console.log('file1.txt:', file1.stdout);
  console.log('file2.txt:', file2.stdout);
  console.log('file3.txt:', file3.stdout);
} catch (error) {
  console.log('Multiple files test failed:', error.message);
}

console.log('\n---\n');

// Test 4: Append mode
console.log('Test 4: Append mode (-a flag)');
try {
  // First write
  await $`echo "First line" | tee append-test.txt`;
  
  // Append
  const result = await $`echo "Second line" | tee -a append-test.txt`;
  console.log('Append mode stdout:', result.stdout);
  
  const fileContent = await $`cat append-test.txt`.catch(() => ({ stdout: 'File not found' }));
  console.log('Append file content:', fileContent.stdout);
} catch (error) {
  console.log('Append test failed:', error.message);
}

// Cleanup
console.log('\nCleaning up test files...');
try {
  await $`rm -f test-output.txt interactive-test.txt file1.txt file2.txt file3.txt append-test.txt`;
  console.log('Cleanup completed.');
} catch (error) {
  console.log('Cleanup failed:', error.message);
}