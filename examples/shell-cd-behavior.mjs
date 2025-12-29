#!/usr/bin/env node

// This file documents how cd SHOULD behave to match shell behavior

import { $, shell, enableVirtualCommands } from '../js/src/$.mjs';

enableVirtualCommands();
shell.verbose(false);

console.log('=== Expected Shell cd Behavior ===\n');

async function testShellBehavior() {
  const originalCwd = process.cwd();

  console.log(
    '1. cd should persist for subsequent commands in the same session:'
  );
  console.log('   $ cd /tmp');
  console.log('   $ pwd');
  console.log('   Expected: /tmp');

  // In a real shell, this would work:
  await $`cd /tmp`;
  const pwd1 = await $`pwd`;
  console.log('   Actual:', pwd1.stdout.trim());
  console.log('   Status:', pwd1.stdout.trim() === '/tmp' ? '✓' : '✗');

  console.log(
    '\n2. cd in command chain should affect all commands in the chain:'
  );
  console.log('   $ cd /usr && pwd');
  console.log('   Expected: /usr');

  const result2 = await $`cd /usr && pwd`;
  console.log('   Actual:', result2.stdout.trim());
  console.log('   Status:', result2.stdout.trim() === '/usr' ? '✓' : '✗');

  console.log('\n3. After chain, directory should still be changed:');
  console.log('   $ pwd');
  console.log('   Expected: /usr (from previous cd)');

  const pwd3 = await $`pwd`;
  console.log('   Actual:', pwd3.stdout.trim());
  console.log('   Status:', pwd3.stdout.trim() === '/usr' ? '✓' : '✗');

  console.log('\n4. Subshell () should NOT affect parent shell:');
  console.log('   $ (cd /tmp && pwd)');
  console.log('   $ pwd');
  console.log('   Expected: still /usr');

  await $`(cd /tmp && pwd)`;
  const pwd4 = await $`pwd`;
  console.log('   Actual after subshell:', pwd4.stdout.trim());
  console.log('   Status:', pwd4.stdout.trim() === '/usr' ? '✓' : '✗');

  console.log('\n5. Multiple cd commands should work sequentially:');
  console.log('   $ cd /var');
  console.log('   $ cd log');
  console.log('   $ pwd');
  console.log('   Expected: /var/log');

  await $`cd /var`;
  await $`cd log`;
  const pwd5 = await $`pwd`;
  console.log('   Actual:', pwd5.stdout.trim());
  console.log('   Status:', pwd5.stdout.trim() === '/var/log' ? '✓' : '✗');

  console.log('\n6. cd with relative paths:');
  console.log('   $ cd ..');
  console.log('   $ pwd');
  console.log('   Expected: /var');

  await $`cd ..`;
  const pwd6 = await $`pwd`;
  console.log('   Actual:', pwd6.stdout.trim());
  console.log('   Status:', pwd6.stdout.trim() === '/var' ? '✓' : '✗');

  // Return to original directory
  process.chdir(originalCwd);

  console.log('\n=== Test Complete ===');
  console.log('Note: This shows the expected shell behavior.');
  console.log('The virtual cd command needs to maintain directory state');
  console.log('across commands in the same $ session, but isolate');
  console.log('subshells created with ().');
}

testShellBehavior().catch(console.error);
