#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

async function testWaitingCommand() {
  console.log('🧪 Testing with command that truly waits');

  // Use a command that definitely waits for input
  const nodeCmd = $`node -e "process.stdin.on('data', d => process.stdout.write('Got: ' + d)); process.stdin.on('end', () => process.exit(0));"`;
  console.log('1. Created node stdin reader command');

  await nodeCmd.start({
    mode: 'async',
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  console.log('2. Started command');

  // Wait a bit for process to start
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log('3. After start:');
  console.log('   started:', nodeCmd.started);
  console.log('   child exists:', !!nodeCmd.child);
  console.log('   finished:', nodeCmd.finished);

  if (nodeCmd.child) {
    console.log('   child.pid:', nodeCmd.child.pid);
    console.log('   child.stdin exists:', !!nodeCmd.child.stdin);
  }

  // Try to access via streams
  const stdin = await nodeCmd.streams.stdin;
  console.log('4. Got stdin via streams:');
  console.log('   type:', typeof stdin);
  console.log('   has write:', !!(stdin && stdin.write));

  if (stdin && stdin.write) {
    console.log('5. Writing to stdin...');
    stdin.write('Hello World\n');
    stdin.end();

    const result = await nodeCmd;
    console.log('   Result:', JSON.stringify(result.stdout));
  } else {
    console.log('5. No writable stdin');
    nodeCmd.kill();
  }
}

testWaitingCommand();
