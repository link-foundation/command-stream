#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Debug child process timing ===');

async function debugChildProcessTiming() {
  const cmd = $`sleep 2`; // Use sleep to keep process alive
  
  console.log('Initial state:');
  console.log('- started:', cmd.started);
  console.log('- finished:', cmd.finished);
  console.log('- child:', !!cmd.child);
  
  console.log('\\nAccessing streams.stdin to trigger auto-start...');
  const stdin = cmd.streams.stdin;
  
  console.log('After accessing streams.stdin:');
  console.log('- stdin result:', !!stdin);
  console.log('- started:', cmd.started); 
  console.log('- finished:', cmd.finished);
  console.log('- child:', !!cmd.child);
  
  if (cmd.child) {
    console.log('- child.stdin:', !!cmd.child.stdin);
    console.log('- child.stdout:', !!cmd.child.stdout);
    console.log('- child.stderr:', !!cmd.child.stderr);
  }
  
  // Wait a bit to see if child appears
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\\nAfter 100ms wait:');
  console.log('- started:', cmd.started);
  console.log('- finished:', cmd.finished);
  console.log('- child:', !!cmd.child);
  
  if (cmd.child) {
    console.log('- child.stdin:', !!cmd.child.stdin);
    console.log('- child.pid:', cmd.child.pid);
  }
  
  // Try accessing again
  const stdin2 = cmd.streams.stdin;
  console.log('\\nSecond access to streams.stdin:');
  console.log('- stdin result:', !!stdin2);
  
  // Let the sleep finish
  const result = await cmd;
  console.log('\\nFinal result:', result.code);
}

debugChildProcessTiming().catch(console.error);