#!/usr/bin/env node

// Example demonstrating CTRL+C handling with command-stream
// This shows how the library properly forwards SIGINT signals to child processes

import { $ } from '../src/$.mjs';

console.log('=== CTRL+C Signal Handling Example ===\n');
console.log('This example demonstrates proper CTRL+C (SIGINT) handling.');
console.log('When you press CTRL+C, the signal is properly forwarded to child processes.\n');

// Example 1: Long-running command that can be interrupted
async function example1() {
  console.log('Example 1: Long-running command (ping)');
  console.log('Press CTRL+C to interrupt...\n');
  
  try {
    // This will inherit stdin and properly handle CTRL+C
    await $`ping -c 100 8.8.8.8`;
    console.log('Ping completed successfully');
  } catch (error) {
    console.log('\n✓ Command interrupted by CTRL+C');
    console.log(`  Exit code: ${error.code}`);
    if (error.code === 130 || error.code === -2) {
      console.log('  (This is the expected exit code for SIGINT)');
    }
  }
}

// Example 2: Sleep command with signal handling
async function example2() {
  console.log('\n\nExample 2: Sleep command');
  console.log('Press CTRL+C to interrupt the 10-second sleep...\n');
  
  try {
    console.log('Sleeping for 10 seconds...');
    await $`sleep 10`;
    console.log('Sleep completed successfully');
  } catch (error) {
    console.log('\n✓ Sleep interrupted by CTRL+C');
    console.log(`  Exit code: ${error.code}`);
  }
}

// Example 3: Custom command with stdin forwarding
async function example3() {
  console.log('\n\nExample 3: Command with stdin forwarding');
  console.log('This example shows that stdin is properly forwarded while still handling CTRL+C\n');
  
  try {
    // Create a simple script that reads input
    await $`echo "Type some text and press Enter, or press CTRL+C to exit:"`;
    await $`head -n 3`; // Read up to 3 lines
    console.log('Input reading completed');
  } catch (error) {
    console.log('\n✓ Command interrupted by CTRL+C');
    console.log(`  Exit code: ${error.code}`);
  }
}

// Main execution
async function main() {
  console.log('Choose an example to run:');
  console.log('1. Long-running ping command');
  console.log('2. Sleep command');
  console.log('3. Command with stdin forwarding');
  console.log('\nOr just run this script to see example 1.\n');
  
  // Default to example 1 for simplicity
  await example1();
  
  console.log('\n=== Example completed ===');
  console.log('The CTRL+C signal was properly handled and forwarded to the child process.');
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Run the main function
main().catch(console.error);