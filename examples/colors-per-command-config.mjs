#!/usr/bin/env node

// Per-command ANSI configuration

import { $ } from '../js/src/$.mjs';

console.log('Per-command ANSI configuration:');
const colorCommand =
  'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m\\n"';

// Test with the process runner's ansi option
const proc = $`sh -c ${colorCommand}`;
proc.options.ansi = { preserveAnsi: false };
const result = await proc;
console.log(`Output with ANSI disabled: "${result.stdout.trim()}"`);
