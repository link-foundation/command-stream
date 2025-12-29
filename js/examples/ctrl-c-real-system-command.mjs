#!/usr/bin/env node

// Real system command CTRL+C handling

import { $ } from '../js/src/$.mjs';

console.log('Real system command (ping)');
console.log('Starting ping command - press CTRL+C to interrupt...\n');

try {
  // Use a real system command that runs indefinitely
  await $`/sbin/ping -c 100 8.8.8.8`;
  console.log('Ping completed successfully');
} catch (error) {
  console.log('\n✓ Ping was interrupted');
  console.log(`Exit code: ${error.code}`);
}
