#!/usr/bin/env node

import { $ } from '../src/$.mjs';

// Enable trace to see what's happening
process.env.COMMAND_STREAM_TRACE = 'ProcessRunner';

async function debugOptions() {
  console.log('🐛 Debugging options and spawn');
  
  const catCmd = $`cat`;
  console.log('1. Created cat command');
  
  // This should trigger auto-start with pipe stdio
  const stdinPromise = catCmd.streams.stdin;
  console.log('2. Accessed streams.stdin (auto-start triggered)');
  
  // Wait for start to complete
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('3. After wait:');
  console.log('   started:', catCmd.started);
  console.log('   child exists:', !!catCmd.child);
  
  if (catCmd.child) {
    console.log('   child.stdin exists:', !!catCmd.child.stdin);
    console.log('   child.stdin type:', typeof catCmd.child.stdin);
  }
  
  const stdin = await stdinPromise;
  console.log('4. Awaited stdin:', typeof stdin, stdin);
  
  catCmd.kill();
}

debugOptions();