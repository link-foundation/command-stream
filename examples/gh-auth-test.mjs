#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('Testing gh auth status with $.mjs\n');

// Test 1: Basic gh auth status with capture
console.log('Test 1: Using .run() with capture');
try {
  const result = await $`gh auth status`.run({ capture: true, mirror: false });
  console.log('Exit code:', result.code);
  console.log('Stdout length:', result.stdout.length);
  console.log('Stderr length:', result.stderr.length);
  console.log('Success: gh auth check passed\n');
} catch (error) {
  console.log('Error with .run():', error.message);
  console.log('Exit code:', error.code);
  console.log('Stdout:', error.stdout);
  console.log('Stderr:', error.stderr);
}

// Test 2: Using await directly
console.log('Test 2: Using await directly');
try {
  const result = await $`gh auth status`;
  console.log('Exit code:', result.code);
  console.log('Success: gh auth check passed\n');
} catch (error) {
  console.log('Error with await:', error.message);
}

// Test 3: Check with 2>&1 redirection
console.log('Test 3: Using 2>&1 redirection');
try {
  const result = await $`gh auth status 2>&1`.run({
    capture: true,
    mirror: false,
  });
  console.log('Exit code:', result.code);
  console.log('Combined output length:', result.stdout.length);
  console.log('Success: gh auth check passed\n');
} catch (error) {
  console.log('Error with redirection:', error.message);
}

// Test 4: Using streaming
console.log('Test 4: Using streaming');
try {
  const cmd = $`gh auth status`;
  let outputReceived = false;

  for await (const chunk of cmd.stream()) {
    outputReceived = true;
    console.log(
      `Received ${chunk.type}: ${chunk.data.toString().slice(0, 50)}...`
    );
  }

  const result = await cmd;
  console.log('Exit code:', result.code);
  console.log('Stream output received:', outputReceived);
  console.log('Success: gh auth check passed\n');
} catch (error) {
  console.log('Error with streaming:', error.message);
}

// Test 5: Check actual authentication status
console.log('Test 5: Parse auth status');
try {
  const result = await $`gh auth status 2>&1`.run({
    capture: true,
    mirror: false,
  });

  // Check if output contains success indicators
  const output = result.stdout + result.stderr;
  const isAuthenticated =
    output.includes('Logged in to') || output.includes('✓');

  console.log('Is authenticated:', isAuthenticated);

  if (isAuthenticated) {
    // Try to extract username
    const usernameMatch = output.match(/account\s+(\S+)/);
    if (usernameMatch) {
      console.log('GitHub username:', usernameMatch[1]);
    }
  }

  // The command might exit with 0 even when not authenticated (just showing status)
  // or exit with 1 when not authenticated
  console.log('Raw exit code:', result.code);
} catch (error) {
  console.log('Failed to check auth status:', error.message);
  console.log('This might mean gh is not authenticated');
}

console.log('\n--- Summary ---');
console.log('gh auth status behavior:');
console.log('- Exit code 0: gh CLI is installed and can show status');
console.log('- Exit code 1: Usually means not authenticated');
console.log('- Output goes to stderr by default (not stdout)');
console.log('- Use 2>&1 to capture the status output');
