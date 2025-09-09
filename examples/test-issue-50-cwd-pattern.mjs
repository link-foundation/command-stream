#!/usr/bin/env node
// Test script to reproduce issue #50: CWD with CD pattern failure

import { $ } from '../src/$.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function demonstrateIssue() {
  console.log('🧪 Testing Issue #50: CWD with CD pattern failure\n');

  // Create a temporary directory for testing
  const tempDir = path.join(os.tmpdir(), `test-cwd-issue-50-${Date.now()}`);
  console.log(`📁 Creating temp directory: ${tempDir}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  const testFile = path.join(tempDir, 'test.txt');
  await fs.promises.writeFile(testFile, 'Test content for issue #50');
  
  console.log(`📝 Created test file: ${testFile}\n`);

  // Test 1: The FAILING pattern (each command runs in separate shell)
  console.log('❌ Test 1: Using cd in separate command (SHOULD FAIL)');
  try {
    const originalCwd = process.cwd();
    console.log(`   Original CWD: ${originalCwd}`);
    
    // This command should NOT work - cd runs in its own shell and doesn't affect the next command
    await $`cd ${tempDir}`;
    console.log(`   After cd command - Node.js CWD: ${process.cwd()}`);
    
    // pwd should still show the original directory, not tempDir
    const pwdResult = await $`pwd`;
    console.log(`   pwd result: ${pwdResult.stdout.trim()}`);
    console.log(`   Expected: ${originalCwd} (because cd didn't persist)`);
    console.log(`   Actual:   ${pwdResult.stdout.trim()}`);
    
    if (pwdResult.stdout.trim() === tempDir) {
      console.log('   ✅ UNEXPECTED: cd actually worked (Node.js CWD changed)');
    } else {
      console.log('   ❌ EXPECTED: cd did NOT persist to next command');
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 2: The chained command pattern (should also fail)
  console.log('❌ Test 2: Using cd && pwd pattern (CURRENTLY FAILS)');
  try {
    const chainResult = await $`cd ${tempDir} && pwd`;
    console.log(`   Chained result: ${chainResult.stdout.trim()}`);
    console.log(`   Expected: ${tempDir}`);
    console.log(`   Actual:   ${chainResult.stdout.trim()}`);
    
    if (chainResult.stdout.trim() === tempDir) {
      console.log('   ✅ SUCCESS: Chained cd && pwd works correctly');
    } else {
      console.log('   ❌ FAIL: Chained cd && pwd does not work as expected');
    }
    
    // Check if Node.js CWD was affected
    console.log(`   Node.js CWD after chain: ${process.cwd()}`);
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 3: The WORKING pattern (using cwd option)
  console.log('✅ Test 3: Using cwd option (SHOULD WORK)');
  try {
    const cwdResult = await $({ cwd: tempDir })`pwd`;
    console.log(`   CWD option result: ${cwdResult.stdout.trim()}`);
    console.log(`   Expected: ${tempDir}`);
    console.log(`   Actual:   ${cwdResult.stdout.trim()}`);
    
    if (cwdResult.stdout.trim() === tempDir) {
      console.log('   ✅ SUCCESS: cwd option works correctly');
    } else {
      console.log('   ❌ FAIL: cwd option did not work as expected');
    }
    
    console.log(`   Node.js CWD after cwd option: ${process.cwd()}`);
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // Cleanup
  console.log(`\n🧹 Cleaning up: ${tempDir}`);
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  
  console.log('\n📋 Summary:');
  console.log('- Issue #50 is about the fact that `cd dir && pwd` pattern doesn\'t work as expected');
  console.log('- The virtual cd command changes Node.js CWD, but shell commands run in separate processes');
  console.log('- For shell operator chains like &&, the cd should work within that shell context');
  console.log('- The solution should make shell operator chains maintain directory context');
}

// Run the demonstration
demonstrateIssue().catch(console.error);