#!/usr/bin/env node

import { $, configureAnsi, AnsiUtils } from './$.mjs';

console.log('=== ANSI Color Handling Comparison ===\n');

// Test with a command that produces colored output
const colorCommand = 'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m"';

console.log('1. Default behavior (ANSI preserved):');
const result1 = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result1.stdout.trim()}"`);

console.log('\n2. Using AnsiUtils to strip ANSI from result:');
const cleanedOutput = AnsiUtils.stripAnsi(result1.stdout);
console.log(`Cleaned: "${cleanedOutput.trim()}"`);

console.log('\n3. Global configuration to disable ANSI preservation:');
configureAnsi({ preserveAnsi: false });
const result2 = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result2.stdout.trim()}"`);

console.log('\n4. Reset to default (preserve ANSI):');
configureAnsi({ preserveAnsi: true });
const result3 = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result3.stdout.trim()}"`);

console.log('\n=== Summary ===');
console.log('✅ ANSI colors preserved by default');
console.log('✅ Easy to strip for processing with AnsiUtils');  
console.log('✅ Configurable globally with configureAnsi()');
console.log('✅ No interference with interactive commands');