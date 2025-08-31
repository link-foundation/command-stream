#!/usr/bin/env node

// Demonstration of CTRL+C signal handling in command-stream
// This example shows how CTRL+C properly terminates child processes

import { $ } from '../src/$.mjs';

console.log('=== CTRL+C Signal Handling Demo ===\n');

// Example 1: Using a real system command
async function realCommandExample() {
  console.log('Example 1: Real system command (ping)');
  console.log('Starting ping command - press CTRL+C to interrupt...\n');
  
  try {
    // Use a real system command that runs indefinitely
    await $`/sbin/ping -c 100 8.8.8.8`;
    console.log('Ping completed successfully');
  } catch (error) {
    console.log('\n✓ Ping was interrupted');
    console.log(`  Exit code: ${error.code}`);
  }
}

// Example 2: Using virtual sleep command
async function virtualCommandExample() {
  console.log('\nExample 2: Virtual sleep command');
  console.log('Sleeping for 30 seconds - press CTRL+C to interrupt...\n');
  
  const result = await $`sleep 30`;
  
  if (result.code === 0) {
    console.log('Sleep completed successfully');
  } else {
    console.log('✓ Sleep was interrupted');
    console.log(`  Exit code: ${result.code}`);
  }
}

// Example 3: Multiple concurrent processes
async function concurrentExample() {
  console.log('\nExample 3: Multiple concurrent processes');
  console.log('Starting 3 processes - press CTRL+C to interrupt all...\n');
  
  try {
    await Promise.all([
      $`/bin/sleep 20`,
      $`/sbin/ping -c 50 google.com`,
      $`/usr/bin/yes > /dev/null`
    ]);
    console.log('All processes completed');
  } catch (error) {
    console.log('\n✓ All processes were interrupted');
    console.log(`  Exit code: ${error.code}`);
  }
}

// Run examples based on command line argument
async function main() {
  const example = process.argv[2] || '1';
  
  switch(example) {
    case '1':
      await realCommandExample();
      break;
    case '2':
      await virtualCommandExample();
      break;
    case '3':
      await concurrentExample();
      break;
    default:
      console.log('Usage: node ctrl-c-demo.mjs [1|2|3]');
      console.log('  1 - Real system command (ping)');
      console.log('  2 - Virtual sleep command');
      console.log('  3 - Multiple concurrent processes');
  }
  
  console.log('\n=== Demo completed ===');
}

main().catch(console.error);