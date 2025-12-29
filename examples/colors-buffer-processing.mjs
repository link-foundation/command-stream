#!/usr/bin/env node

// Using AnsiUtils.cleanForProcessing() for Buffer data

import { $, AnsiUtils } from '../js/src/$.mjs';

console.log('Using AnsiUtils.cleanForProcessing() for Buffer data:');
const colorCommand =
  'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m \\033[34mBlue text\\033[0m\\n"';

const result = await $`sh -c ${colorCommand}`;
const buffer = Buffer.from(result.stdout);
const cleanBuffer = AnsiUtils.cleanForProcessing(buffer);
console.log(`Clean buffer: "${cleanBuffer.toString().trim()}"`);
