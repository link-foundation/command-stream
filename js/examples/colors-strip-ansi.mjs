#!/usr/bin/env node

// Using AnsiUtils.stripAnsi() for clean data processing

import { $, AnsiUtils } from '../js/src/$.mjs';

console.log('Using AnsiUtils.stripAnsi() for clean data processing:');
const colorCommand =
  'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m\\n"';

const result = await $`sh -c ${colorCommand}`;
const stripped = AnsiUtils.stripAnsi(result.stdout);
console.log(`Stripped: "${stripped.trim()}"`);
