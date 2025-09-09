#!/usr/bin/env node
// Comprehensive test for stderr handling fix

import { $ } from '../src/$.mjs';

console.log('=== Comprehensive stderr handling test ===\n');

const tests = [
  {
    name: 'Basic stderr redirection',
    cmd: 'echo "error message" >&2',
    expectedStdout: '',
    expectedStderr: 'error message\n'
  },
  {
    name: 'Mixed stdout and stderr',
    cmd: 'echo "stdout" && echo "stderr" >&2',
    expectedStdout: 'stdout\n',
    expectedStderr: 'stderr\n'
  },
  {
    name: '2>&1 redirection',
    cmd: 'sh -c "echo \\"to stderr\\" >&2" 2>&1',
    expectedStdout: 'to stderr\n',
    expectedStderr: ''
  },
  {
    name: 'Normal stdout (should still work)',
    cmd: 'echo "normal output"',
    expectedStdout: 'normal output\n',
    expectedStderr: ''
  }
];

let passed = 0;
let total = tests.length;

for (const test of tests) {
  console.log(`Testing: ${test.name}`);
  console.log(`  Command: ${test.cmd}`);
  
  try {
    const result = await $`${test.cmd}`;
    
    const stdoutMatch = result.stdout === test.expectedStdout;
    const stderrMatch = result.stderr === test.expectedStderr;
    
    console.log(`  stdout: ${JSON.stringify(result.stdout)} ${stdoutMatch ? '✓' : '✗'}`);
    console.log(`  stderr: ${JSON.stringify(result.stderr)} ${stderrMatch ? '✓' : '✗'}`);
    
    if (stdoutMatch && stderrMatch) {
      console.log(`  Result: PASS ✓`);
      passed++;
    } else {
      console.log(`  Result: FAIL ✗`);
      console.log(`    Expected stdout: ${JSON.stringify(test.expectedStdout)}`);
      console.log(`    Expected stderr: ${JSON.stringify(test.expectedStderr)}`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
    console.log(`  Result: FAIL ✗`);
  }
  
  console.log('');
}

console.log(`=== Summary: ${passed}/${total} tests passed ===`);

if (passed === total) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.');
  process.exit(1);
}