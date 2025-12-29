#!/usr/bin/env node

// Silent streaming (no mirror to terminal)

import { $ } from '../js/src/$.mjs';

console.log('Silent streaming (no mirror to terminal):');
console.log('Running ping -c 3 127.0.0.1 with mirror: false...\n');

try {
  const $silent = $({ mirror: false });

  for await (const chunk of $silent`ping -c 3 127.0.0.1`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        // Custom formatting since we're not mirroring
        console.log(`🔇 Silent: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
