#!/usr/bin/env node

// This file documents command-stream's invocation-scoped cd behavior.

import { $, shell, enableVirtualCommands } from '../src/$.mjs';

enableVirtualCommands();
shell.verbose(false);

console.log('=== Expected Shell cd Behavior ===\n');

async function testShellBehavior() {
  const originalCwd = process.cwd();

  console.log('1. A standalone cd should not change the host process:');
  console.log('   $ cd /tmp');
  console.log('   $ pwd');
  console.log(`   Expected: ${originalCwd}`);

  await $`cd /tmp`;
  const pwd1 = await $`pwd`;
  console.log('   Actual:', pwd1.stdout.trim());
  console.log('   Status:', pwd1.stdout.trim() === originalCwd ? '✓' : '✗');

  console.log(
    '\n2. cd in command chain should affect all commands in the chain:'
  );
  console.log('   $ cd /usr && pwd');
  console.log('   Expected: /usr');

  const result2 = await $`cd /usr && pwd`;
  console.log('   Actual:', result2.stdout.trim());
  console.log('   Status:', result2.stdout.trim() === '/usr' ? '✓' : '✗');

  console.log('\n3. After a chain, the host directory should be restored:');
  console.log('   $ pwd');
  console.log(`   Expected: ${originalCwd}`);

  const pwd3 = await $`pwd`;
  console.log('   Actual:', pwd3.stdout.trim());
  console.log('   Status:', pwd3.stdout.trim() === originalCwd ? '✓' : '✗');

  console.log('\n4. Subshell () should NOT affect parent shell:');
  console.log('   $ (cd /tmp && pwd)');
  console.log('   $ pwd');
  console.log(`   Expected: still ${originalCwd}`);

  await $`(cd /tmp && pwd)`;
  const pwd4 = await $`pwd`;
  console.log('   Actual after subshell:', pwd4.stdout.trim());
  console.log('   Status:', pwd4.stdout.trim() === originalCwd ? '✓' : '✗');

  console.log('\n5. Multiple cd commands should work sequentially:');
  console.log('   $ cd /var && cd log && pwd');
  console.log('   Expected: /var/log');

  const result5 = await $`cd /var && cd log && pwd`;
  console.log('   Actual:', result5.stdout.trim());
  console.log('   Status:', result5.stdout.trim() === '/var/log' ? '✓' : '✗');

  console.log('\n6. cd with relative paths:');
  console.log('   $ cd /var/log && cd .. && pwd');
  console.log('   Expected: /var');

  const result6 = await $`cd /var/log && cd .. && pwd`;
  console.log('   Actual:', result6.stdout.trim());
  console.log('   Status:', result6.stdout.trim() === '/var' ? '✓' : '✗');

  // Return to original directory
  process.chdir(originalCwd);

  console.log('\n=== Test Complete ===');
  console.log('Directory state is shared inside one $ invocation and restored');
  console.log('before control returns to the host process.');
}

testShellBehavior().catch(console.error);
