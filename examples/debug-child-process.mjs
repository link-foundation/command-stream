#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

async function debugChildProcess() {
  console.log('🐛 Debugging child process creation');

  const catCmd = $`cat`;
  console.log('1. Created cat command');
  console.log('   started:', catCmd.started);
  console.log('   finished:', catCmd.finished);
  console.log('   child:', !!catCmd.child);

  console.log('2. Accessing streams.stdin (should trigger auto-start)...');
  const stdinPromise = catCmd.streams.stdin;
  console.log('   stdinPromise:', typeof stdinPromise);
  console.log('   started after access:', catCmd.started);
  console.log('   child after access:', !!catCmd.child);

  // Wait a bit for the process to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log('3. After 100ms wait:');
  console.log('   started:', catCmd.started);
  console.log('   child:', !!catCmd.child);
  console.log(
    '   child.stdin:',
    catCmd.child ? typeof catCmd.child.stdin : 'no child'
  );

  console.log('4. Awaiting stdin promise...');
  const stdin = await stdinPromise;

  console.log('5. Stdin resolved:');
  console.log('   stdin type:', typeof stdin);
  console.log('   stdin value:', stdin);
  console.log('   has write method:', !!(stdin && stdin.write));

  // Clean up
  catCmd.kill();
}

debugChildProcess();
