#!/usr/bin/env node

// Reset to default (preserve ANSI)

import { $, configureAnsi } from '../js/src/$.mjs';

console.log('Reset to default (preserve ANSI):');
configureAnsi({ preserveAnsi: true });
const colorCommand =
  'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m"';
const result = await $`sh -c ${colorCommand}`;
console.log(`Output: "${result.stdout.trim()}"`);
