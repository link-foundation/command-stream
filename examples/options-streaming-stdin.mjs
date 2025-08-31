#!/usr/bin/env node

// Streaming with custom stdin using $({ stdin }) syntax

import { $ } from '../src/$.mjs';

console.log('Streaming with custom stdin:');
const $withStdin = $({ stdin: 'Hello\nWorld\n', mirror: false });

try {
  for await (const chunk of $withStdin`cat -n`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output) {
        console.log(`📝 Input: ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}