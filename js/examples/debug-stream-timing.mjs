#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Stream Timing Debug ===');

disableVirtualCommands();
const cmd = $`echo "test"`;
cmd.start();

console.log('Immediately after start:');
console.log('child:', cmd.child);
console.log('stdout:', cmd.stdout);

await new Promise((resolve) => setTimeout(resolve, 50));
console.log('After 50ms:');
console.log('child:', cmd.child);
console.log('stdout:', cmd.stdout);

await new Promise((resolve) => setTimeout(resolve, 100));
console.log('After 150ms total:');
console.log('child:', cmd.child);
console.log('stdout:', cmd.stdout);

await cmd;
console.log('After await:');
console.log('child:', cmd.child);
console.log('stdout:', cmd.stdout);
