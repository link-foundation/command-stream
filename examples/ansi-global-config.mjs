#!/usr/bin/env node

// Global configuration to disable ANSI preservation

import { $, configureAnsi } from '../src/$.mjs';

console.log('Global configuration to disable ANSI preservation:');
configureAnsi({ preserveAnsi: false });
const colorCommand = 'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m"';
const result = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result.stdout.trim()}"`);