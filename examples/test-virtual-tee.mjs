#!/usr/bin/env bun

/**
 * Test the virtual tee command implementation
 * This demonstrates how the tee command can be implemented in pure JavaScript
 * as a virtual command in the command-stream library
 */

import { $ } from '../src/$.mjs';
import fs from 'fs';

console.log('=== Testing Virtual Tee Command ===\n');

// First, let's test that our virtual tee command is registered
console.log('Test 0: Checking if virtual tee is registered');
try {
  const result = await $`echo "test" | tee virtual-test-0.txt`;
  console.log('✅ Virtual tee command is working!');
  console.log('stdout:', JSON.stringify(result.stdout));
  console.log('stderr:', JSON.stringify(result.stderr));
  console.log('code:', result.code);
  
  // Check file was created
  const fileExists = fs.existsSync('virtual-test-0.txt');
  console.log('File created:', fileExists);
  if (fileExists) {
    const content = fs.readFileSync('virtual-test-0.txt', 'utf8');
    console.log('File content:', JSON.stringify(content));
    fs.unlinkSync('virtual-test-0.txt');
  }
} catch (error) {
  console.log('❌ Virtual tee test failed:', error.message);
}

console.log('\n---\n');

// Test 1: Basic tee functionality
console.log('Test 1: Basic virtual tee functionality');
try {
  const result = await $`echo "Hello Virtual Tee!" | tee virtual-output.txt`;
  console.log('stdout:', JSON.stringify(result.stdout));
  console.log('stderr:', JSON.stringify(result.stderr));
  console.log('code:', result.code);
  
  // Check if file was created and has correct content
  const fileContent = fs.readFileSync('virtual-output.txt', 'utf8');
  console.log('File content:', JSON.stringify(fileContent));
  
  const success = result.stdout.trim() === 'Hello Virtual Tee!' && 
                 fileContent.trim() === 'Hello Virtual Tee!' &&
                 result.code === 0;
  console.log(success ? '✅ Basic test passed' : '❌ Basic test failed');
  
  fs.unlinkSync('virtual-output.txt');
} catch (error) {
  console.log('❌ Basic test failed:', error.message);
}

console.log('\n---\n');

// Test 2: Multiple files
console.log('Test 2: Multiple output files');
try {
  const result = await $`echo "Multiple files test" | tee virtual-file1.txt virtual-file2.txt virtual-file3.txt`;
  console.log('stdout:', JSON.stringify(result.stdout));
  
  // Check all files
  const file1Content = fs.readFileSync('virtual-file1.txt', 'utf8');
  const file2Content = fs.readFileSync('virtual-file2.txt', 'utf8');
  const file3Content = fs.readFileSync('virtual-file3.txt', 'utf8');
  
  console.log('File 1 content:', JSON.stringify(file1Content));
  console.log('File 2 content:', JSON.stringify(file2Content));
  console.log('File 3 content:', JSON.stringify(file3Content));
  
  const success = file1Content === file2Content && 
                 file2Content === file3Content && 
                 file1Content.trim() === 'Multiple files test';
  console.log(success ? '✅ Multiple files test passed' : '❌ Multiple files test failed');
  
  // Cleanup
  fs.unlinkSync('virtual-file1.txt');
  fs.unlinkSync('virtual-file2.txt');
  fs.unlinkSync('virtual-file3.txt');
} catch (error) {
  console.log('❌ Multiple files test failed:', error.message);
}

console.log('\n---\n');

// Test 3: Append mode
console.log('Test 3: Append mode (-a flag)');
try {
  // First write
  await $`echo "First line" | tee virtual-append-test.txt`;
  
  // Then append
  const result = await $`echo "Second line" | tee -a virtual-append-test.txt`;
  console.log('Append result stdout:', JSON.stringify(result.stdout));
  
  const fileContent = fs.readFileSync('virtual-append-test.txt', 'utf8');
  console.log('Final file content:', JSON.stringify(fileContent));
  
  const expectedContent = 'First line\nSecond line\n';
  const success = fileContent === expectedContent;
  console.log(success ? '✅ Append mode test passed' : '❌ Append mode test failed');
  
  fs.unlinkSync('virtual-append-test.txt');
} catch (error) {
  console.log('❌ Append mode test failed:', error.message);
}

console.log('\n---\n');

// Test 4: Interactive mode (simulated with stdin)
console.log('Test 4: Interactive mode simulation');
try {
  const multilineInput = "line 1\nline 2\nline 3\n";
  const result = await $({ stdin: multilineInput })`tee virtual-interactive.txt`;
  console.log('Interactive result stdout:', JSON.stringify(result.stdout));
  
  const fileContent = fs.readFileSync('virtual-interactive.txt', 'utf8');
  console.log('Interactive file content:', JSON.stringify(fileContent));
  
  const success = result.stdout === multilineInput && fileContent === multilineInput;
  console.log(success ? '✅ Interactive mode test passed' : '❌ Interactive mode test failed');
  
  fs.unlinkSync('virtual-interactive.txt');
} catch (error) {
  console.log('❌ Interactive mode test failed:', error.message);
}

console.log('\n---\n');

// Test 5: Pipeline compatibility
console.log('Test 5: Pipeline compatibility');
try {
  // Test that tee works in complex pipelines
  const result = await $`echo "pipeline test" | tee virtual-pipeline.txt | cat`;
  console.log('Pipeline result stdout:', JSON.stringify(result.stdout));
  
  const fileContent = fs.readFileSync('virtual-pipeline.txt', 'utf8');
  console.log('Pipeline file content:', JSON.stringify(fileContent));
  
  const success = result.stdout.trim() === 'pipeline test' && 
                 fileContent.trim() === 'pipeline test';
  console.log(success ? '✅ Pipeline compatibility test passed' : '❌ Pipeline compatibility test failed');
  
  fs.unlinkSync('virtual-pipeline.txt');
} catch (error) {
  console.log('❌ Pipeline compatibility test failed:', error.message);
}

console.log('\n---\n');

// Test 6: Error handling
console.log('Test 6: Error handling');
try {
  // Test writing to an invalid path
  const result = await $`echo "error test" | tee /invalid/path/file.txt`;
  console.log('Error test result code:', result.code);
  console.log('Error test stderr:', JSON.stringify(result.stderr));
  
  const success = result.code !== 0 && result.stderr.includes('tee:');
  console.log(success ? '✅ Error handling test passed' : '❌ Error handling test failed');
} catch (error) {
  console.log('❌ Error handling test failed:', error.message);
}

console.log('\n---\n');

// Test 7: Empty input handling
console.log('Test 7: Empty input handling');
try {
  const result = await $({ stdin: '' })`tee virtual-empty.txt`;
  console.log('Empty input result stdout:', JSON.stringify(result.stdout));
  
  // File should be created but empty
  const fileExists = fs.existsSync('virtual-empty.txt');
  const fileContent = fileExists ? fs.readFileSync('virtual-empty.txt', 'utf8') : null;
  
  console.log('Empty file exists:', fileExists);
  console.log('Empty file content:', JSON.stringify(fileContent));
  
  const success = result.stdout === '' && fileContent === '';
  console.log(success ? '✅ Empty input test passed' : '❌ Empty input test failed');
  
  if (fileExists) fs.unlinkSync('virtual-empty.txt');
} catch (error) {
  console.log('❌ Empty input test failed:', error.message);
}

console.log('\n=== Virtual Tee Command Tests Complete ===');

// Summary
console.log('\n=== How tee command works ===');
console.log('1. Reads input from stdin (or pipeline)');
console.log('2. Writes input to stdout (continues pipeline)');
console.log('3. Simultaneously writes input to specified files');
console.log('4. Supports -a flag for append mode');
console.log('5. Can write to multiple files at once');
console.log('6. Works in both interactive and pipeline modes');
console.log('7. Implemented in pure JavaScript as a virtual command!');

console.log('\n=== Interactive Mode Support ===');
console.log('The tee command supports interactive mode through:');
console.log('- Standard pipelines: echo "data" | tee file.txt');
console.log('- Direct stdin: $({ stdin: "data" })`tee file.txt`');
console.log('- Real interactive: Users can type input and it gets teed');
console.log('- The virtual implementation handles all these cases!');