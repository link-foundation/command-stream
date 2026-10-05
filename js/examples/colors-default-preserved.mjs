#!/usr/bin/env node

// Default behavior (ANSI colors preserved)

import { $ } from '../src/$.mjs';

console.log('Default behavior (ANSI colors preserved):');
const colorCommand =
  'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m\\n"';

const result = await $`sh -c ${colorCommand}`;
console.log('Visual output:');
process.stdout.write(result.stdout); // Show actual colors
console.log('Raw string representation:');
console.log(`"${result.stdout.replace(/\x1b/g, '\\x1b')}"`);
