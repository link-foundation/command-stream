#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

async function testNonVirtual() {
  console.log('🧪 Testing with definitely non-virtual command');

  // Use wc which should not be virtual
  const wcCmd = $`wc -l`;
  console.log('1. Created wc command');

  // Check if process spawns properly with regular async execution
  console.log('2. Testing normal execution first...');
  const testCmd = $`wc -l`;
  const testResult = await testCmd.start({ stdin: 'test\nline2\n' });
  console.log('   Normal execution result:', testResult.stdout.trim());

  // Now test streams
  console.log('3. Testing streams...');
  await wcCmd.start({
    mode: 'async',
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  console.log('4. After start:');
  console.log('   started:', wcCmd.started);
  console.log('   child exists:', !!wcCmd.child);
  console.log('   finished:', wcCmd.finished);

  if (wcCmd.child) {
    console.log('   child.pid:', wcCmd.child.pid);
    console.log('   child.stdin:', typeof wcCmd.child.stdin);
  }

  // Try direct access to child stdin if available
  if (wcCmd.child && wcCmd.child.stdin) {
    console.log('5. Direct child.stdin access works!');
    wcCmd.child.stdin.write('line1\n');
    wcCmd.child.stdin.write('line2\n');
    wcCmd.child.stdin.end();

    const result = await wcCmd;
    console.log('   Direct access result:', result.stdout.trim());
  } else {
    console.log('5. No child.stdin available');
    wcCmd.kill();
  }
}

testNonVirtual();
