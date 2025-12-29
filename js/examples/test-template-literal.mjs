#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';

enableVirtualCommands();
shell.verbose(true);

console.log('=== Testing template literal with spaces ===\n');

const pathWithSpaces = '/tmp/my test dir';

console.log('Variable value:', pathWithSpaces);

// Test 1: Direct template literal
console.log('\nTest 1: Template literal interpolation');
console.log('Command will be: cd', pathWithSpaces);

// Capture what command is actually generated
const originalCwd = process.cwd();

// Try manually constructing the command
console.log('\nTest 2: Manual command string');
const cmdString = `cd "${pathWithSpaces}"`;
console.log('Manual command string:', cmdString);
const result = await $([cmdString]);
console.log('Result code:', result.code);
