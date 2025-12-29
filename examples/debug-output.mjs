#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../js/src/$.mjs';

enableVirtualCommands();
shell.verbose(false);

console.log('=== Debug Output Test ===\n');

console.log('Test 1: Simple pwd');
const r1 = await $`pwd`;
console.log('Output:', JSON.stringify(r1.stdout));
console.log('Trimmed:', JSON.stringify(r1.stdout.trim()));

console.log('\nTest 2: cd /tmp ; pwd');
const r2 = await $`cd /tmp ; pwd`;
console.log('Output:', JSON.stringify(r2.stdout));
console.log('Trimmed:', JSON.stringify(r2.stdout.trim()));

console.log('\nTest 3: cd /tmp ; pwd ; cd /usr ; pwd');
const r3 = await $`cd /tmp ; pwd ; cd /usr ; pwd`;
console.log('Output:', JSON.stringify(r3.stdout));
console.log('Split:', r3.stdout.trim().split('\n'));

process.chdir('/workspace/command-stream');
