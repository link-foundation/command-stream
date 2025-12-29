#!/usr/bin/env node

// Using AnsiUtils to strip ANSI from result

import { $, AnsiUtils } from '../js/src/$.mjs';

console.log('Using AnsiUtils to strip ANSI from result:');
const colorCommand =
  'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m"';
const result = await $`sh -c ${colorCommand}`;
const cleanedOutput = AnsiUtils.stripAnsi(result.stdout);
console.log(`Cleaned: "${cleanedOutput.trim()}"`);
