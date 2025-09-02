#!/usr/bin/env node

// Default behavior (ANSI preserved)

import { $ } from '../src/$.mjs';

console.log('Default behavior (ANSI preserved):');
const colorCommand = 'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m"';
const result = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result.stdout.trim()}"`);