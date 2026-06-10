#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';

enableVirtualCommands();
shell.verbose(false);

console.log('Testing cd command behavior:\n');

// Test 1: Basic cd should persist within chain
console.log('Test 1: cd should persist within chain');
const originalCwd = process.cwd();
console.log('Original cwd:', originalCwd);

const result1 = await $`cd /tmp && pwd`;
console.log('After "cd /tmp && pwd":', result1.stdout.trim());

const result2 = await $`pwd`;
console.log('Next pwd (should be back to original):', result2.stdout.trim());

console.log('\nTest 2: Multiple cd in chain');
const result3 = await $`cd /tmp && pwd && cd /usr && pwd`;
console.log('Result of "cd /tmp && pwd && cd /usr && pwd":');
console.log(result3.stdout);

console.log('\nTest 3: cd in subshell should not affect parent');
await $`(cd /tmp && pwd)`;
const result4 = await $`pwd`;
console.log('pwd after subshell cd:', result4.stdout.trim());

console.log('\nTest 4: Separate cd commands');
await $`cd /tmp`;
const result5 = await $`pwd`;
console.log('After separate "cd /tmp":', result5.stdout.trim());

await $`cd /usr`;
const result6 = await $`pwd`;
console.log('After separate "cd /usr":', result6.stdout.trim());

// Return to original
process.chdir(originalCwd);
console.log('\nFinal cwd:', process.cwd());
