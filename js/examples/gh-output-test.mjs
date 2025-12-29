#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Testing where gh auth status outputs go ===\n');

// Test 1: Capture stdout and stderr separately
console.log('Test 1: Capture stdout and stderr separately');
try {
  const result = await $`gh auth status`.run({ capture: true, mirror: false });
  console.log('Exit code:', result.code);
  console.log(
    'Stdout content:',
    result.stdout ? `"${result.stdout.slice(0, 50)}..."` : '(empty)'
  );
  console.log('Stdout length:', result.stdout?.length || 0);
  console.log(
    'Stderr content:',
    result.stderr ? `"${result.stderr.slice(0, 50)}..."` : '(empty)'
  );
  console.log('Stderr length:', result.stderr?.length || 0);

  // Check where the actual output is
  if (result.stdout && result.stdout.includes('Logged in')) {
    console.log('✅ Output is in STDOUT');
  } else if (result.stderr && result.stderr.includes('Logged in')) {
    console.log('⚠️ Output is in STDERR (need 2>&1 redirection)');
  } else {
    console.log('❌ Output not found in either stdout or stderr');
  }
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n---\n');

// Test 2: With 2>&1 redirection
console.log('Test 2: With 2>&1 redirection to capture all output');
try {
  const result = await $`gh auth status 2>&1`.run({
    capture: true,
    mirror: false,
  });
  console.log('Exit code:', result.code);
  console.log(
    'Combined stdout content:',
    result.stdout ? `"${result.stdout.slice(0, 50)}..."` : '(empty)'
  );
  console.log('Combined stdout length:', result.stdout?.length || 0);
  console.log(
    'Stderr after redirect:',
    result.stderr ? `"${result.stderr.slice(0, 50)}..."` : '(empty)'
  );
  console.log('Stderr length:', result.stderr?.length || 0);

  if (result.stdout && result.stdout.includes('Logged in')) {
    console.log('✅ Output captured successfully with 2>&1');
  }
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n---\n');

// Test 3: Test if we're authenticated
console.log('Test 3: Authentication check');
try {
  // First try without redirection
  const result1 = await $`gh auth status`.run({ capture: true, mirror: false });
  const output1 = (result1.stdout || '') + (result1.stderr || '');

  // Then try with redirection
  const result2 = await $`gh auth status 2>&1`.run({
    capture: true,
    mirror: false,
  });
  const output2 = result2.stdout || '';

  // Use whichever has content
  const output = output1.length > output2.length ? output1 : output2;

  if (output.includes('✓') && output.includes('Logged in to')) {
    console.log('✅ Authenticated to GitHub');
    const userMatch = output.match(/account\s+(\S+)/);
    if (userMatch) {
      console.log('   User:', userMatch[1]);
    }
    const scopeMatch = output.match(/Token scopes:\s*'([^']+)'/);
    if (scopeMatch) {
      console.log('   Scopes:', scopeMatch[1]);
    }
  } else {
    console.log('❌ Not authenticated or unable to parse status');
  }
} catch (error) {
  console.log('Error checking auth:', error.message);
}

console.log('\n=== Summary ===');
console.log('gh auth status outputs to STDOUT (not STDERR) when successful');
console.log('Use `.run({ capture: true })` to capture the output');
console.log('Exit code 0 = authenticated, 1 = not authenticated');
