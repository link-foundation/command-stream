#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testRealShellCommands() {
  console.log('Testing with real shell commands...');

  // Test with a real shell command (ls should exist on most systems)
  console.log('\n1. Testing real shell command with capture: false:');
  const result1 = await $`ls /tmp`.start({ capture: false });
  console.log('Result stdout:', JSON.stringify(result1.stdout)); // Should be undefined
  console.log('Result code:', result1.code);

  // Test with a real shell command with capture: true
  console.log('\n2. Testing real shell command with capture: true:');
  const result2 = await $`ls /tmp`.start({ capture: true });
  console.log('Result stdout type:', typeof result2.stdout); // Should be string
  console.log('Result stdout length:', result2.stdout?.length || 0);
  console.log('Result code:', result2.code);

  // Test with mirror: false to capture but not show output
  console.log('\n3. Testing real shell command with mirror: false:');
  const result3 = await $`ls -la /tmp`.start({ mirror: false, capture: true });
  console.log('Result stdout type:', typeof result3.stdout);
  console.log('Result stdout lines:', result3.stdout?.split('\n').length || 0);
  console.log('Result code:', result3.code);

  console.log('\nAll tests completed!');
}

testRealShellCommands().catch(console.error);
