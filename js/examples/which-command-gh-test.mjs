#!/usr/bin/env node

// Testing which gh (the command from GitHub issue #7)

import { $ } from '../src/$.mjs';

console.log('Testing which gh (the command from the GitHub issue):');
try {
  const result = await $`which gh`;
  console.log(`Exit code: ${result.code}`);
  console.log(`Output: ${result.stdout.trim()}`);
  if (result.stderr) {
    console.log(`Stderr: ${result.stderr.trim()}`);
  }

  if (result.code === 0) {
    console.log('✅ SUCCESS: which gh now returns exit code 0');
  } else {
    console.log('❌ FAILED: which gh still returns non-zero exit code');
  }
} catch (error) {
  console.log('❌ ERROR:', error.message);
}
