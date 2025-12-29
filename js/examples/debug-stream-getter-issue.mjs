#!/usr/bin/env node

import { $, disableVirtualCommands } from '../js/src/$.mjs';

console.log('=== Stream Getter Issue Debug ===');

// Test the exact same scenario as the failing test
disableVirtualCommands();

const process = $`echo "stream test"`;
process.start();

// Wait longer for child process initialization
await new Promise((resolve) => setTimeout(resolve, 100));

console.log('process.child:', process.child);
console.log('process.child === null:', process.child === null);
console.log('process.child === undefined:', process.child === undefined);

console.log('Checking getter logic step by step:');
console.log('this.child ? this.child.stdout : null');

if (process.child) {
  console.log('Branch: this.child is truthy');
  console.log('this.child.stdout:', process.child.stdout);
  console.log('returning this.child.stdout');
} else {
  console.log('Branch: this.child is falsy');
  console.log('returning null');
}

console.log('process.stdout:', process.stdout);
console.log('process.stdout === null:', process.stdout === null);
console.log('process.stdout === undefined:', process.stdout === undefined);
console.log('typeof process.stdout:', typeof process.stdout);

await process;
