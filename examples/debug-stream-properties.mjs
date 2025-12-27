#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Stream Properties Debug ===');

console.log('1. Testing with virtual commands (default):');
const cmd1 = $`echo "test1"`;
cmd1.start();
await new Promise((resolve) => setTimeout(resolve, 20));
console.log(
  'Virtual - stdout:',
  !!cmd1.stdout,
  'stderr:',
  !!cmd1.stderr,
  'stdin:',
  !!cmd1.stdin
);
console.log('Virtual - child:', !!cmd1.child);
await cmd1;

console.log('\n2. Testing with real commands:');
disableVirtualCommands();
const cmd2 = $`echo "test2"`;
cmd2.start();
await new Promise((resolve) => setTimeout(resolve, 20));
console.log(
  'Real - stdout:',
  !!cmd2.stdout,
  'stderr:',
  !!cmd2.stderr,
  'stdin:',
  !!cmd2.stdin
);
console.log('Real - child:', !!cmd2.child);
console.log('Real - child.stdout:', !!cmd2.child?.stdout);
await cmd2;
