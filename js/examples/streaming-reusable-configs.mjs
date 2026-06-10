#!/usr/bin/env node

// Reusable streaming configurations

import { $ } from '../src/$.mjs';

console.log('Reusable streaming configurations:');

// Create different "profiles" for streaming
const $json = $({ mirror: false });
const $quiet = $({ mirror: false, capture: true });
const $verbose = $({ mirror: true });

try {
  // JSON-like structured output
  console.log('JSON-style output:');
  for await (const chunk of $json`echo '{"status":"running","progress":50}'`.stream()) {
    if (chunk.type === 'stdout') {
      try {
        const data = JSON.parse(chunk.data.toString());
        console.log(`📋 Status: ${data.status}, Progress: ${data.progress}%`);
      } catch {
        console.log(`📋 Raw: ${chunk.data.toString().trim()}`);
      }
    }
  }

  // Quiet mode with post-processing
  console.log('\nQuiet mode with result capture:');
  const runner = $quiet`echo "Result: $(date)"`;

  let streamOutput = '';
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout') {
      streamOutput += chunk.data.toString();
    }
  }

  const result = await runner;
  console.log(`🤫 Streamed: "${streamOutput.trim()}"`);
  console.log(`💾 Captured: "${result.stdout.trim()}"`);

  // Verbose mode (will show in terminal too)
  console.log('\nVerbose mode (also shows in terminal):');
  for await (const chunk of $verbose`echo "This appears both in terminal and here"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`📢 Processed: ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
