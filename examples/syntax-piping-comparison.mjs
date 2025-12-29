#!/usr/bin/env node

// Command chaining with different options comparison

import { $ } from '../js/src/$.mjs';

console.log('Command chaining with different options:');

console.log('Regular $ with pipes:');
try {
  for await (const chunk of $`echo "apple,banana,cherry" | tr ',' '\\n' | sort`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach((line) => console.log(`🔗 Piped: ${line}`));
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}

console.log('\nConfigured $ with pipes:');
const $pipe = $({ mirror: false });
try {
  for await (const chunk of $pipe`echo "zebra,yak,xerus" | tr ',' '\\n' | sort -r`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach((line) => console.log(`⚙️  Configured: ${line}`));
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
