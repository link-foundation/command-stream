#!/usr/bin/env node

// Multiple concurrent processes CTRL+C handling

import { $ } from '../src/$.mjs';

console.log('Multiple concurrent processes');
console.log('Starting 3 processes - press CTRL+C to interrupt all...\n');

try {
  await Promise.all([
    $`/bin/sleep 20`,
    $`/sbin/ping -c 50 google.com`,
    $`/usr/bin/yes > /dev/null`
  ]);
  console.log('All processes completed');
} catch (error) {
  console.log('\n✓ All processes were interrupted');
  console.log(`Exit code: ${error.code}`);
}