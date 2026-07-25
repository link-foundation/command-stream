#!/usr/bin/env node

// Interactive-style streaming with custom stdin

import { $ } from '../src/$.mjs';

console.log('Interactive streaming with pre-filled input:');
const commands = 'ls -la\necho "Current directory listing"\nexit\n';
const $interactive = $({ stdin: commands, mirror: false });

try {
  for await (const chunk of $interactive`bash`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`🖥️  ${line}`);
        }
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
