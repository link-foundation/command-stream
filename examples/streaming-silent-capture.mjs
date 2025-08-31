#!/usr/bin/env node

// Long-running command with silent capture

import { $ } from '../src/$.mjs';

console.log('Long-running with silent capture:');
const $longSilent = $({ mirror: false, capture: true });

try {
  const startTime = Date.now();
  for await (const chunk of $longSilent`sleep 2 && echo "Task completed"`.stream()) {
    if (chunk.type === 'stdout') {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏱️  [${elapsed}s] ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}