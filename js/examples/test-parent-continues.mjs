#!/usr/bin/env node

// Test that parent process continues after child is interrupted

import { $ } from '../src/$.mjs';

async function test() {
  console.log('Testing that parent continues after child interruption...\n');

  // Start first command
  console.log('1. Starting first sleep command...');
  const runner1 = $`sleep 5`;
  const promise1 = runner1.start();

  // Kill it after 500ms
  setTimeout(() => {
    console.log('   Killing first command...');
    runner1.kill();
  }, 500);

  const result1 = await promise1;
  console.log(`   First command finished with code: ${result1.code}`);

  // Parent continues - start another command
  console.log('\n2. Parent continues - starting second command...');
  const runner2 = $`echo "Parent is still alive!"`;
  const result2 = await runner2;
  console.log(`   Second command output: ${result2.stdout.trim()}`);
  console.log(`   Second command finished with code: ${result2.code}`);

  // Start a third command to prove we're still running
  console.log('\n3. Starting third command...');
  const result3 = await $`echo "Still running after interruption"`;
  console.log(`   Third command output: ${result3.stdout.trim()}`);

  console.log(
    '\n✓ SUCCESS: Parent process continued running after child interruption'
  );
  console.log(
    "This is the correct behavior - parent doesn't exit on child SIGINT"
  );
}

test().catch(console.error);
