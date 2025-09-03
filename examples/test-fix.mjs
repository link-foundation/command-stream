#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testFix() {
  console.log('🧪 Testing the stdin pipe fix');
  
  const sortCmd = $`sort`;
  console.log('1. Created sort command');
  
  // Start with pipe stdin
  const startPromise = sortCmd.start({ mode: 'async', stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  
  // Add timeout to avoid hanging
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Start timed out')), 2000);
  });
  
  try {
    await Promise.race([startPromise, timeoutPromise]);
    console.log('2. Started successfully');
  } catch (error) {
    console.log('2. Start timeout (process is waiting - good!)');
  }
  
  console.log('3. Checking child status:');
  console.log('   started:', sortCmd.started);
  console.log('   child exists:', !!sortCmd.child);
  console.log('   finished:', sortCmd.finished);
  
  if (sortCmd.child) {
    console.log('   child.stdin exists:', !!sortCmd.child.stdin);
    console.log('   child.stdin writable:', sortCmd.child.stdin ? sortCmd.child.stdin.writable : 'N/A');
  }
  
  // Now test streams access
  const stdinPromise = sortCmd.streams.stdin;
  const stdinTimeout = new Promise((resolve) => {
    setTimeout(() => resolve('TIMEOUT'), 1000);
  });
  
  const stdin = await Promise.race([stdinPromise, stdinTimeout]);
  console.log('4. Got stdin:');
  console.log('   result:', stdin === 'TIMEOUT' ? 'TIMEOUT' : typeof stdin);
  console.log('   has write:', stdin && stdin.write ? 'YES' : 'NO');
  
  if (stdin && stdin.write) {
    console.log('5. SUCCESS! Writing to stdin...');
    stdin.write('zebra\n');
    stdin.write('apple\n');
    stdin.end();
    
    const result = await sortCmd;
    console.log('   Sorted result:', JSON.stringify(result.stdout));
  } else {
    console.log('5. Cleaning up...');
    sortCmd.kill();
  }
  
  console.log('Test complete');
}

testFix();