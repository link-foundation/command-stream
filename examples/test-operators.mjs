#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';

enableVirtualCommands();
shell.verbose(true);

console.log('=== Testing Shell Operators with cd ===\n');

const originalCwd = process.cwd();

console.log('Test 1: && operator (AND - run next if previous succeeds)');
console.log('Command: cd /tmp && pwd');
const result1 = await $`cd /tmp && pwd`;
console.log('Output:', result1.stdout);
console.log('After command, cwd is:', process.cwd());
console.log();

// Reset
process.chdir(originalCwd);

console.log('Test 2: || operator (OR - run next if previous fails)');  
console.log('Command: cd /nonexistent || echo "failed to cd"');
const result2 = await $`cd /nonexistent || echo "failed to cd"`;
console.log('Output:', result2.stdout);
console.log();

console.log('Test 3: ; operator (semicolon - run regardless)');
console.log('Command: cd /tmp ; pwd ; cd /usr ; pwd');
const result3 = await $`cd /tmp ; pwd ; cd /usr ; pwd`;
console.log('Output:', result3.stdout);
console.log('After command, cwd is:', process.cwd());
console.log();

// Reset
process.chdir(originalCwd);

console.log('Test 4: Subshell with ()');
console.log('Command: (cd /tmp && pwd) ; pwd');
const result4 = await $`(cd /tmp && pwd) ; pwd`;
console.log('Output:', result4.stdout);
console.log('After command, cwd is:', process.cwd());
console.log();

console.log('Test 5: Complex chain');
console.log('Command: cd /tmp && echo "in tmp" && cd /usr && echo "in usr"');
const result5 = await $`cd /tmp && echo "in tmp" && cd /usr && echo "in usr"`;
console.log('Output:', result5.stdout);
console.log('After command, cwd is:', process.cwd());

// Reset to original
process.chdir(originalCwd);
console.log('\n=== Tests Complete ===');