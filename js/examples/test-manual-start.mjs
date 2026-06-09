#!/usr/bin/env node

import { $ } from '../src/$.mjs';

async function testManualStart() {
  console.log('🧪 Testing manual start with pipe stdin');

  // Start manually with correct options
  const sortCmd = $`sort`;
  console.log('1. Created sort command');

  // Manual start with correct stdio
  await sortCmd.start({
    mode: 'async',
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  console.log('2. Manually started with pipe stdio');

  console.log('3. After manual start:');
  console.log('   started:', sortCmd.started);
  console.log('   child exists:', !!sortCmd.child);

  if (sortCmd.child) {
    console.log('   child.stdin exists:', !!sortCmd.child.stdin);
    console.log(
      '   child.stdin writable:',
      sortCmd.child.stdin ? sortCmd.child.stdin.writable : 'N/A'
    );
    console.log('   child.stdin type:', typeof sortCmd.child.stdin);
  }

  // Now try to get stdin through streams
  const stdin = await sortCmd.streams.stdin;
  console.log('4. Got stdin through streams:');
  console.log('   type:', typeof stdin);
  console.log('   has write:', !!(stdin && stdin.write));

  if (stdin && stdin.write) {
    console.log('5. Writing to stdin...');
    stdin.write('zebra\n');
    stdin.write('apple\n');
    stdin.end();

    const result = await sortCmd;
    console.log('   Result:', JSON.stringify(result.stdout));
  } else {
    console.log('5. No writable stdin, killing...');
    sortCmd.kill();
  }
}

testManualStart();
