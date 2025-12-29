#!/usr/bin/env node

// Multiple configured instances with different options

import { $ } from '../js/src/$.mjs';

console.log('Multiple configured instances:');
const $quiet = $({ mirror: false });
const $verbose = $({ mirror: true });

try {
  console.log('Running quiet ping...');
  for await (const chunk of $quiet`ping -c 2 127.0.0.1`.stream()) {
    if (
      chunk.type === 'stdout' &&
      chunk.data.toString().includes('bytes from')
    ) {
      console.log(`🤫 Quiet result: ping successful`);
    }
  }

  console.log('\nRunning verbose ping...');
  let count = 0;
  for await (const chunk of $verbose`ping -c 2 127.0.0.1`.stream()) {
    if (
      chunk.type === 'stdout' &&
      chunk.data.toString().includes('bytes from')
    ) {
      count++;
      console.log(`📢 Verbose: packet #${count} received`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
