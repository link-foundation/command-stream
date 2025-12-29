#!/usr/bin/env node

// Virtual sleep command CTRL+C handling

import { $ } from '../js/src/$.mjs';

console.log('Virtual sleep command');
console.log('Sleeping for 30 seconds - press CTRL+C to interrupt...\n');

const result = await $`sleep 30`;

if (result.code === 0) {
  console.log('Sleep completed successfully');
} else {
  console.log('✓ Sleep was interrupted');
  console.log(`Exit code: ${result.code}`);
}
