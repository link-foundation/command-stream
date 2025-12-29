#!/usr/bin/env node

// Filtering only ping replies (no summary)

import { $ } from '../js/src/$.mjs';

console.log('Filtering only ping replies (no summary):');
console.log('Running ping -c 3 1.1.1.1...\n');

try {
  for await (const chunk of $`ping -c 3 1.1.1.1`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      // Only show lines with ping replies (contain "bytes from")
      if (output.includes('bytes from')) {
        console.log(`📡 ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
