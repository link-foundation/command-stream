#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing CTRL+C with explicit stdio inherit');
console.log('Press CTRL+C to interrupt the ping command...');
console.log('---');

// Set up SIGINT handler to see if parent process receives it
process.on('SIGINT', () => {
  console.log('\n[Parent process received SIGINT]');
  process.exit(130); // Standard exit code for SIGINT
});

try {
  // Test with different configurations
  console.log(
    'Running with default settings (should inherit stdin/stdout/stderr)...'
  );
  const result = await $({
    stdin: 'inherit',
    capture: false,
    mirror: true,
  })`ping 8.8.8.8`;
  console.log('Command completed normally:', result);
} catch (error) {
  console.log('Command was interrupted or failed');
  console.log('Error:', error.message);
  console.log('Exit code:', error.code);
}
