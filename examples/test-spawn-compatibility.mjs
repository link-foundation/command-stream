#!/usr/bin/env node

// Test script to validate cross-spawn compatibility
import $ from '../src/$.mjs';

console.log('Testing $.spawn() compatibility with cross-spawn API...\n');

// Test 2: Spawn.sync (synchronous) first since it's simpler  
console.log('1. Testing spawn.sync (synchronous):');
try {
  const result = $.spawn.sync('echo', ['Hello from spawn.sync!'], { stdio: 'inherit' });
  console.log(`   -> Process exited with code: ${result.status}\n`);
  
  // Test 3: Error handling
  console.log('2. Testing error handling (non-existent command):');
  const errorResult = $.spawn.sync('nonexistent-command-12345', [], { stdio: 'pipe' });
  if (errorResult.error) {
    console.log(`   -> Expected error: ${errorResult.error.message}\n`);
  } else {
    console.log(`   -> Unexpected success: ${errorResult.status}\n`);
  }
  
  // Test 4: Output capture
  console.log('3. Testing output capture:');
  const captureResult = $.spawn.sync('echo', ['captured output'], { encoding: 'utf8' });
  console.log(`   -> Captured stdout: "${captureResult.stdout.trim()}"`);
  console.log(`   -> Exit code: ${captureResult.status}\n`);
  
  console.log('All $.spawn() compatibility tests completed!');
} catch (error) {
  console.error('Error in spawn.sync test:', error);
}