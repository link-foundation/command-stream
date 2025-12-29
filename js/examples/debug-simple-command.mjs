#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function debugSimpleCommand() {
  console.log('🐛 Testing with a simple non-builtin command');

  // Use sort instead of cat
  const sortCmd = $`sort`;
  console.log('1. Created sort command');

  const stdinPromise = sortCmd.streams.stdin;
  console.log('2. Accessed streams.stdin');

  // Wait longer
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('3. After 500ms wait:');
  console.log('   started:', sortCmd.started);
  console.log('   child exists:', !!sortCmd.child);

  if (sortCmd.child) {
    console.log('   child.stdin exists:', !!sortCmd.child.stdin);
    console.log(
      '   child.stdin writable:',
      sortCmd.child.stdin ? sortCmd.child.stdin.writable : 'N/A'
    );
  }

  const stdin = await stdinPromise;
  console.log('4. Awaited stdin:');
  console.log('   type:', typeof stdin);
  console.log('   is null:', stdin === null);
  console.log('   has write:', !!(stdin && stdin.write));

  // Try to write if we have a real stream
  if (stdin && stdin.write) {
    console.log('5. Trying to write...');
    stdin.write('test\n');
    stdin.end();

    const result = await sortCmd;
    console.log('   Result:', JSON.stringify(result.stdout));
  } else {
    sortCmd.kill();
  }
}

debugSimpleCommand();
