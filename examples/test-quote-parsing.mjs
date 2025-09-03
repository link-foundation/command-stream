#!/usr/bin/env node

import { parseShellCommand } from '../src/shell-parser.mjs';

const tests = [
  'cd "/tmp/my dir"',
  'cd /tmp/my\\ dir',
  "cd '/tmp/my dir'",
  'echo "hello world"',
];

console.log('=== Testing quote parsing ===\n');

for (const cmd of tests) {
  console.log(`Command: ${cmd}`);
  const parsed = parseShellCommand(cmd);
  console.log('Parsed:', JSON.stringify(parsed, null, 2));
  
  if (parsed && parsed.type === 'simple' && parsed.args.length > 0) {
    console.log('First arg value:', parsed.args[0].value);
  }
  console.log();
}