#!/usr/bin/env node
// Simple stderr test

import { $ } from '../src/$.mjs';
import { needsRealShell } from '../src/shell-parser.mjs';

const cmd = 'echo "test" >&2';
console.log(`Command: ${cmd}`);
console.log(`needsRealShell: ${needsRealShell(cmd)}`);

// Test with verbose logging to see execution path
process.env.COMMAND_STREAM_VERBOSE = 'true';

try {
  console.log('\nExecuting...');
  const result = await $`echo "test" >&2`;
  console.log('Result:', { 
    stdout: JSON.stringify(result.stdout), 
    stderr: JSON.stringify(result.stderr) 
  });
} catch (error) {
  console.log('Error:', error.message);
  console.log('Error stdout:', error.stdout);
  console.log('Error stderr:', error.stderr);
}