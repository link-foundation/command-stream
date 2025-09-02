#!/usr/bin/env node

// Silent streaming using $({ mirror: false }) syntax

import { $ } from '../src/$.mjs';

console.log('Silent streaming (mirror: false):');
const $silent = $({ mirror: false });

try {
  for await (const chunk of $silent`ping -c 3 8.8.8.8`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        console.log(`🔇 Silent: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}