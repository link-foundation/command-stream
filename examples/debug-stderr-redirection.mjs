#!/usr/bin/env node
// Debug stderr redirection handling

import { $ } from '../src/$.mjs';
import { parseShellCommand, needsRealShell } from '../src/shell-parser.mjs';

console.log('=== Debug stderr redirection handling ===\n');

// Test different stderr redirection patterns
const testCommands = [
  'echo "test" >&2',
  'echo "test" 2>&1',
  'echo "test" >&2 2>&1',
  'echo "test" 2>test.log',
  'gh pr create --title "test"',
];

for (const cmd of testCommands) {
  console.log(`\nTesting: ${cmd}`);
  console.log(`  needsRealShell: ${needsRealShell(cmd)}`);
  
  try {
    const parsed = parseShellCommand(cmd);
    console.log(`  parsed: ${parsed ? 'success' : 'null (fallback to shell)'}`);
    if (parsed) {
      console.log(`  parsed type: ${parsed.type}`);
    }
  } catch (error) {
    console.log(`  parsing error: ${error.message}`);
  }
}

console.log('\n=== Testing actual execution ===\n');

// Test with verbose mode to see what path is taken
process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('1. Simple stderr redirection:');
try {
  const result = await $`echo "Hello stderr" >&2`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
} catch (error) {
  console.log('  Error:', error.message);
}

console.log('\n2. Testing 2>&1 redirection:');
try {
  const result = await $`echo "Hello stderr" >&2 2>&1`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
} catch (error) {
  console.log('  Error:', error.message);
}