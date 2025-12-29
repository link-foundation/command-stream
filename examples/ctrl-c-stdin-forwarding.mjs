#!/usr/bin/env node

// Command with stdin forwarding and CTRL+C handling

import { $ } from '../js/src/$.mjs';

console.log('Command with stdin forwarding');
console.log(
  'This example shows that stdin is properly forwarded while still handling CTRL+C\n'
);

try {
  // Create a simple script that reads input
  await $`echo "Type some text and press Enter, or press CTRL+C to exit:"`;
  await $`head -n 3`; // Read up to 3 lines
  console.log('Input reading completed');
} catch (error) {
  console.log('\n✓ Command interrupted by CTRL+C');
  console.log(`Exit code: ${error.code}`);
}
