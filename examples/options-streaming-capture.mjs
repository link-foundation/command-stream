#!/usr/bin/env node

// Capture enabled with streaming using $({ capture: true })

import { $ } from '../src/$.mjs';

console.log('Capture enabled with streaming:');
const $capture = $({ capture: true, mirror: false });

try {
  const runner = $capture`echo -e "Line 1\nLine 2\nLine 3"`;
  
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString();
      console.log(`📦 Streaming: ${output.trim()}`);
    }
  }
  
  const result = await runner;
  console.log(`💾 Final captured: "${result.stdout.trim()}"`);
} catch (error) {
  console.log(`Error: ${error.message}`);
}