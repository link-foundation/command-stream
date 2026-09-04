#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('Testing CTRL+C handling with ping command');
console.log('Press CTRL+C to interrupt the ping command...');
console.log('---');

try {
  // Test with ping command that runs indefinitely
  const result = await $`ping 8.8.8.8`;
  console.log('Command completed normally:', result);
} catch (error) {
  console.log('Command was interrupted or failed');
  console.log('Error:', error.message);
  console.log('Exit code:', error.code);
}
