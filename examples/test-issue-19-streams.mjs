#!/usr/bin/env node

/**
 * Test script for issue #19 - Return real streams or stream wrappers
 * Tests that result.stdout, result.stderr, and result.stdin are proper streams
 */

import { $ } from '../src/$.mjs';
import { Readable, Writable } from 'stream';

console.log('=== Issue #19 Stream Functionality Test ===\n');

async function testStreamFunctionality() {
  console.log('1. Testing basic stream properties:');
  
  const result = await $`echo "hello world"`;
  
  // Check if they are actually stream instances
  console.log('  result.stdout instanceof Readable:', result.stdout instanceof Readable);
  console.log('  result.stderr instanceof Readable:', result.stderr instanceof Readable);
  console.log('  result.stdin instanceof Writable:', result.stdin instanceof Writable);
  
  // Check stream methods exist
  console.log('  result.stdout has pipe method:', typeof result.stdout.pipe === 'function');
  console.log('  result.stdout has read method:', typeof result.stdout.read === 'function');
  console.log('  result.stdin has write method:', typeof result.stdin.write === 'function');
  
  console.log('\n2. Testing stream reading:');
  
  // Test reading from stdout stream
  let chunks = [];
  result.stdout.on('data', (chunk) => {
    chunks.push(chunk.toString());
    console.log('    Received chunk:', JSON.stringify(chunk.toString()));
  });
  
  result.stdout.on('end', () => {
    console.log('    Stream ended');
    console.log('    Combined data:', JSON.stringify(chunks.join('')));
  });
  
  // Start reading
  result.stdout.read();
  
  console.log('\n3. Testing backward compatibility:');
  
  // Test string-like behavior
  console.log('  result.stdout as string:', JSON.stringify(result.stdout.toString()));
  console.log('  result.stdout.trim():', JSON.stringify(result.stdout.trim()));
  console.log('  result.stdout.length:', result.stdout.length);
  console.log('  result.stdout.includes("hello"):', result.stdout.includes("hello"));
  
  console.log('\n4. Testing writable stream (stdin):');
  
  // Test writing to stdin stream
  const result2 = await $`cat`;
  const chunks2 = [];
  
  result2.stdin.on('data', (chunk) => {
    chunks2.push(chunk.toString());
    console.log('    Written data received:', JSON.stringify(chunk.toString()));
  });
  
  result2.stdin.write('test data\n');
  result2.stdin.write('more test data\n');
  result2.stdin.end();
  
  // Wait a bit for stream processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('    All written data:', JSON.stringify(chunks2.join('')));
  
  console.log('\n✅ All stream tests completed');
}

testStreamFunctionality().catch(console.error);