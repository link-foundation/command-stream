#!/usr/bin/env node

import { parseShellCommand, needsRealShell } from '../src/shell-parser.mjs';

const testCases = [
  'cd /tmp',
  'cd /tmp && pwd',
  'cd /tmp || echo "failed"',
  'cd /tmp ; pwd ; cd /usr',
  '(cd /tmp && pwd)',
  '(cd /tmp && pwd) ; pwd',
  'cd /tmp && echo "hello" && cd /usr',
  'ls -la | grep test | wc -l',
  'cd "/path with spaces" && pwd',
  'echo "hello world" > file.txt',
  'cat < input.txt > output.txt',
  'cd /tmp && (cd /usr && pwd) && pwd',
  'false || echo "failed" && echo "success"',
];

console.log('=== Shell Parser Test ===\n');

for (const cmd of testCases) {
  console.log(`Command: ${cmd}`);

  if (needsRealShell(cmd)) {
    console.log('  Needs real shell: YES');
  } else {
    console.log('  Needs real shell: NO');
  }

  const parsed = parseShellCommand(cmd);
  console.log('  Parsed:', JSON.stringify(parsed, null, 2));
  console.log();
}

console.log('=== Test Complete ===');
