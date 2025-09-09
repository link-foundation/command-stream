#!/usr/bin/env node

/**
 * Debug script to understand issue #19 - Return real streams or stream wrappers
 * Current behavior: result.stdout/stderr/stdin are strings
 * Desired behavior: They should be readable/writable streams
 */

import { $ } from '../src/$.mjs';

console.log('=== Issue #19 Debug - Current vs Desired Behavior ===\n');

async function testCurrentBehavior() {
  console.log('1. Current behavior - result contains strings:');
  
  const result = await $`echo "hello world"`;
  
  console.log('  result.stdout type:', typeof result.stdout);
  console.log('  result.stdout constructor:', result.stdout?.constructor?.name);
  console.log('  result.stdout instanceof Object:', result.stdout instanceof Object);
  console.log('  result.stdout value:', result.stdout);
  console.log('  result.stdout JSON:', JSON.stringify(result.stdout));
  console.log('  result.stderr type:', typeof result.stderr);
  console.log('  result.stderr constructor:', result.stderr.constructor.name);
  console.log('  result.stdin type:', typeof result.stdin);
  console.log('  result.stdin constructor:', result.stdin.constructor.name);
  console.log('  Is result.stdout a stream?', result.stdout && typeof result.stdout.pipe === 'function');
  console.log('  Is result.stdout readable?', result.stdout && typeof result.stdout.read === 'function');
  console.log('  Is result.stdin writable?', result.stdin && typeof result.stdin.write === 'function');
  
  // Test stream functionality
  console.log('  Testing stream methods:');
  console.log('    result.stdout.trim():', JSON.stringify(result.stdout.trim()));
  console.log('    result.stdout.length:', result.stdout.length);
  
  console.log('\n2. Current streams interface (works correctly):');
  
  const cmd = $`echo "hello from streams"`;
  const stdout = await cmd.streams.stdout;
  console.log('  cmd.streams.stdout type:', typeof stdout);
  console.log('  Is cmd.streams.stdout a stream?', stdout && typeof stdout.pipe === 'function');
  console.log('  Is cmd.streams.stdout readable?', stdout && typeof stdout.read === 'function');
  
  await cmd; // Wait for completion
}

testCurrentBehavior().catch(console.error);