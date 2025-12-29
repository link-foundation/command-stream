#!/usr/bin/env node

// Sleep command with signal handling

import { $ } from '../js/src/$.mjs';

console.log('Sleep command');
console.log('Press CTRL+C to interrupt the 10-second sleep...\n');

try {
  console.log('Sleeping for 10 seconds...');
  await $`sleep 10`;
  console.log('Sleep completed successfully');
} catch (error) {
  console.log('\n✓ Sleep interrupted by CTRL+C');
  console.log(`Exit code: ${error.code}`);
}
