#!/usr/bin/env node

// Test for GitHub issue #7: Built-in 'which' command returns non-zero exit code for existing commands
// https://github.com/link-foundation/command-stream/issues/7

import { $ } from '../src/$.mjs';

console.log('=== Testing GitHub Issue #7: which command fix ===\n');

// Test 1: Test with gh command (the specific case from the issue)
console.log('1. Testing which gh (the command from the GitHub issue):');
try {
  const result = await $`which gh`;
  console.log(`Exit code: ${result.code}`);
  console.log(`Output: ${result.stdout.trim()}`);
  if (result.stderr) console.log(`Stderr: ${result.stderr.trim()}`);
  
  if (result.code === 0) {
    console.log('✅ SUCCESS: which gh now returns exit code 0');
  } else {
    console.log('❌ FAILED: which gh still returns non-zero exit code');
  }
} catch (error) {
  console.log('❌ ERROR:', error.message);
}

// Test 2: Compare with system which
console.log('\n2. Comparing with system /usr/bin/which:');
try {
  const systemResult = await $`/usr/bin/which gh`;
  const builtinResult = await $`which gh`;
  
  console.log(`System which exit code: ${systemResult.code}`);
  console.log(`Builtin which exit code: ${builtinResult.code}`);
  console.log(`System which output: ${systemResult.stdout.trim()}`);
  console.log(`Builtin which output: ${builtinResult.stdout.trim()}`);
  
  if (systemResult.code === builtinResult.code) {
    console.log('✅ SUCCESS: Exit codes match between system and builtin which');
  } else {
    console.log('❌ FAILED: Exit codes differ between system and builtin which');
  }
} catch (error) {
  console.log('❌ ERROR:', error.message);
}

// Test 3: Test with common commands
console.log('\n3. Testing with other common commands:');
const commands = ['sh', 'ls', 'cat', 'grep'];

for (const cmd of commands) {
  try {
    const result = await $`which ${cmd}`;
    console.log(`which ${cmd}: exit code ${result.code}, path: ${result.stdout.trim()}`);
  } catch (error) {
    console.log(`which ${cmd}: ERROR: ${error.message}`);
  }
}

// Test 4: Test non-existent command
console.log('\n4. Testing non-existent command:');
try {
  const result = await $`which nonexistent-command-xyz`;
  console.log(`Exit code: ${result.code}`);
  console.log(`Stderr: ${result.stderr.trim()}`);
  
  if (result.code === 1) {
    console.log('✅ SUCCESS: Non-existent command returns exit code 1');
  } else {
    console.log('❌ FAILED: Non-existent command should return exit code 1');
  }
} catch (error) {
  console.log('❌ ERROR:', error.message);
}

console.log('\n=== GitHub Issue #7 Test Complete ===');