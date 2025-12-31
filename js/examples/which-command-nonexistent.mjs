#!/usr/bin/env node

// Testing non-existent command

import { $ } from '../src/$.mjs';

console.log('Testing non-existent command:');
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
