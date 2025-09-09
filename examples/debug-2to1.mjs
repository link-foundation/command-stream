#!/usr/bin/env node
// Debug 2>&1 redirection

import { $ } from '../src/$.mjs';
import { needsRealShell } from '../src/shell-parser.mjs';

const cmd = 'echo "to stderr" >&2 2>&1';
console.log(`Command: ${cmd}`);
console.log(`needsRealShell: ${needsRealShell(cmd)}`);

// Compare with command that works (pure shell execution)
console.log('\nTesting with pure shell execution (bash -c):');

import { execSync } from 'child_process';

try {
  const result = execSync('bash -c \'echo "to stderr" >&2 2>&1\'', { 
    encoding: 'utf8', 
    stdio: ['pipe', 'pipe', 'pipe'] 
  });
  console.log('Pure shell stdout:', JSON.stringify(result));
} catch (error) {
  console.log('Pure shell stderr via error:', JSON.stringify(error.stderr));
  console.log('Pure shell stdout via error:', JSON.stringify(error.stdout));
}

console.log('\nTesting with command-stream:');
try {
  const result = await $`echo "to stderr" >&2 2>&1`;
  console.log('command-stream stdout:', JSON.stringify(result.stdout));
  console.log('command-stream stderr:', JSON.stringify(result.stderr));
} catch (error) {
  console.log('Error:', error.message);
}