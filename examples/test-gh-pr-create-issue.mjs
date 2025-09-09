#!/usr/bin/env node
// Test case to reproduce gh pr create output capture issue

import { $ } from '../src/$.mjs';
import { execSync } from 'child_process';

console.log('=== Testing gh pr create output capture issue ===\n');

// First test with a simple command that outputs to stderr
console.log('1. Testing with a simple stderr command:');
try {
  const result = await $`echo "stdout message" && echo "stderr message" >&2`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  Combined output should show both streams captured');
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n2. Testing gh command availability:');
try {
  const result = await $`gh --version`;
  console.log('  gh version:', result.stdout.split('\n')[0]);
} catch (error) {
  console.log('  gh CLI not available:', error.message);
  console.log('  Skipping gh pr create test');
  process.exit(1);
}

console.log('\n3. Simulating gh pr create behavior:');
// gh pr create actually outputs to stderr, let's simulate this
try {
  // This command mimics how gh pr create behaves - outputting URL to stderr
  const result = await $`echo "https://github.com/test/repo/pull/123" >&2`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  
  if (result.stderr.includes('https://github.com')) {
    console.log('  ✓ PASS: stderr captured PR URL correctly');
  } else {
    console.log('  ✗ FAIL: stderr did not capture PR URL');
  }
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n4. Comparison with execSync:');
try {
  const execResult = execSync('echo "https://github.com/test/repo/pull/456" >&2', { 
    encoding: 'utf8', 
    stdio: ['pipe', 'pipe', 'pipe'] 
  });
  console.log('  execSync stdout:', JSON.stringify(execResult));
} catch (error) {
  // execSync captures stderr in error.stderr
  console.log('  execSync stderr via error:', JSON.stringify(error.stderr));
}

console.log('\n5. Testing with 2>&1 redirection:');
try {
  const result = await $`echo "https://github.com/test/repo/pull/789" >&2 2>&1`;
  console.log('  stdout with 2>&1:', JSON.stringify(result.stdout));
  console.log('  stderr with 2>&1:', JSON.stringify(result.stderr));
  
  if (result.stdout.includes('https://github.com')) {
    console.log('  ✓ PASS: 2>&1 redirection works as workaround');
  } else {
    console.log('  ✗ FAIL: 2>&1 redirection did not work');
  }
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n=== Test completed ===');