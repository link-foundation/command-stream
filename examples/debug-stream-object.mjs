#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function debugStreamObject() {
  console.log('=== Debug stream object details ===');
  
  const cmd = $`cat`;
  
  console.log('Before accessing streams:');
  console.log('  started:', cmd.started);
  console.log('  child:', !!cmd.child);
  
  const stdin = await cmd.streams.stdin;
  
  console.log('\\nAfter accessing streams:');
  console.log('  started:', cmd.started);
  console.log('  child:', !!cmd.child);
  console.log('  stdin type:', typeof stdin);
  console.log('  stdin is null?', stdin === null);
  console.log('  stdin constructor:', stdin ? stdin.constructor.name : 'N/A');
  
  if (stdin) {
    console.log('  stdin methods:', Object.getOwnPropertyNames(stdin).filter(name => typeof stdin[name] === 'function').slice(0, 10));
    console.log('  writable?', stdin.writable);
    console.log('  destroyed?', stdin.destroyed);
  }
  
  if (cmd.child) {
    console.log('\\nChild process details:');
    console.log('  child.stdin type:', typeof cmd.child.stdin);
    console.log('  child.stdin === stdin?', cmd.child.stdin === stdin);
    console.log('  child.stdin writable?', cmd.child.stdin ? cmd.child.stdin.writable : 'N/A');
  }
  
  // Try to write anyway
  if (stdin && stdin.write) {
    console.log('\\nWriting to stdin...');
    stdin.write('test data\\n');
    stdin.end();
  } else {
    console.log('\\nCannot write to stdin, ending command');
    cmd.kill();
  }
  
  const result = await cmd;
  console.log('\\nResult:', result);
}

debugStreamObject().catch(console.error);