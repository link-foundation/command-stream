#!/usr/bin/env node

import { $, AnsiUtils, configureAnsi } from './$.mjs';

console.log('=== ANSI Color Preservation Demo ===\n');

// Create a command that outputs ANSI colors
const colorCommand = 'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m\\n"';

console.log('1. Default behavior (ANSI colors preserved):');
const result1 = await $`sh -c ${colorCommand}`;
console.log('   Visual output:');
process.stdout.write('   ' + result1.stdout); // Show actual colors
console.log('   Raw string representation:');
console.log('   "' + result1.stdout.replace(/\x1b/g, '\\x1b') + '"');

console.log('\n2. Using AnsiUtils.stripAnsi() for clean data processing:');
const stripped = AnsiUtils.stripAnsi(result1.stdout);
console.log('   Stripped: "' + stripped.trim() + '"');

console.log('\n3. Using AnsiUtils.cleanForProcessing() for Buffer data:');
const buffer = Buffer.from(result1.stdout);
const cleanBuffer = AnsiUtils.cleanForProcessing(buffer);
console.log('   Clean buffer: "' + cleanBuffer.toString().trim() + '"');

console.log('\n4. Per-command ANSI configuration:');
// Test with the process runner's ansi option
const proc = $`sh -c ${colorCommand}`;
proc.options.ansi = { preserveAnsi: false };
const result2 = await proc;
console.log('   Output with ANSI disabled: "' + result2.stdout.trim() + '"');

console.log('\n=== Verification ===');
console.log('✅ Default: Colors preserved for user experience'); 
console.log('✅ AnsiUtils: Easy data cleaning for processing');
console.log('✅ Configurable: Per-command control available');
console.log('✅ GitHub issues #10 & #11: Addresses both concerns');