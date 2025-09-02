#!/usr/bin/env node

import { $, AnsiUtils } from '../src/$.mjs';

console.log('=== ANSI Color Example with ls command ===\n');

// Use ls with color output
console.log('1. Running ls --color=always (preserves ANSI colors by default):');
try {
  const result = await $`ls --color=always -la`;
  console.log('Raw output with ANSI codes:');
  console.log(result.stdout);
  
  console.log('\n2. Same output with ANSI codes stripped:');
  const cleanOutput = AnsiUtils.stripAnsi(result.stdout);
  console.log(cleanOutput);
  
  console.log('\n3. Raw bytes showing ANSI escape sequences:');
  console.log('First 200 chars as bytes:', Buffer.from(result.stdout.slice(0, 200)));
  
} catch (error) {
  console.log('Note: ls --color might not be available on macOS, trying alternative...');
  
  // Try with a different colored command
  const result = await $`printf "\033[31mRed\033[0m \033[32mGreen\033[0m \033[34mBlue\033[0m\n"`;
  console.log('Raw output with ANSI codes:');
  process.stdout.write(result.stdout); // Write directly to see colors
  
  console.log('\nSame output with ANSI codes stripped:');
  console.log(AnsiUtils.stripAnsi(result.stdout));
  
  console.log('\nRaw bytes showing escape sequences:');
  console.log(Buffer.from(result.stdout));
}