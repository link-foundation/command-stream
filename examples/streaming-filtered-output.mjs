#!/usr/bin/env node

// Stream processing with filtering (only error-like output)

import { $ } from '../src/$.mjs';

console.log('Filtered streaming (only error-like output):');
const $filtered = $({ mirror: false });

try {
  const testScript = `
echo "INFO: Starting process"
echo "WARNING: This is a warning" >&2
echo "DEBUG: Processing data"
echo "ERROR: Something went wrong" >&2
echo "INFO: Process completed"
`;

  for await (const chunk of $filtered`bash -c '${testScript}'`.stream()) {
    const output = chunk.data.toString().trim();
    
    if (chunk.type === 'stderr' || output.includes('ERROR') || output.includes('WARNING')) {
      const prefix = chunk.type === 'stderr' ? '🚨' : '⚠️';
      console.log(`${prefix} ${output}`);
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}