#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testSimpleStreaming() {
  console.log('🧪 Testing simple streaming after fix');
  
  // Test 1: Basic stdin control
  const sortCmd = $`sort`;
  const stdin = await sortCmd.streams.stdin;
  
  stdin.write('zebra\n');
  stdin.write('apple\n');
  stdin.end();
  
  const result = await sortCmd;
  console.log('✅ Sort result:', result.stdout);
  
  // Test 2: Grep filter
  const grepCmd = $`grep "test"`;
  const grepStdin = await grepCmd.streams.stdin;
  
  grepStdin.write('no match\n');
  grepStdin.write('this is test\n');
  grepStdin.end();
  
  const grepResult = await grepCmd;
  console.log('✅ Grep result:', grepResult.stdout);
}

testSimpleStreaming();