#!/usr/bin/env node

// Long-running command that can be interrupted with CTRL+C

import { $ } from '../src/$.mjs';

console.log('Long-running command (ping)');
console.log('Press CTRL+C to interrupt...\n');

try {
  // This will inherit stdin and properly handle CTRL+C
  await $`ping -c 100 8.8.8.8`;
  console.log('Ping completed successfully');
} catch (error) {
  console.log('\n✓ Command interrupted by CTRL+C');
  console.log(`Exit code: ${error.code}`);
  if (error.code === 130 || error.code === -2) {
    console.log('(This is the expected exit code for SIGINT)');
  }
}