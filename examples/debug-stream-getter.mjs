#!/usr/bin/env node

import { $, disableVirtualCommands } from '../src/$.mjs';

console.log('=== Stream Getter Debug ===');

disableVirtualCommands();
const cmd = $`echo "test"`;
cmd.start();
await new Promise(resolve => setTimeout(resolve, 100));

console.log('child:', cmd.child);
console.log('child type:', typeof cmd.child);
console.log('stdout:', cmd.stdout);
console.log('stdout type:', typeof cmd.stdout);
console.log('stdout === null:', cmd.stdout === null);
console.log('stdout === undefined:', cmd.stdout === undefined);

await cmd;
