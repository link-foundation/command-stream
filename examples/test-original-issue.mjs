#!/usr/bin/env node
// Test based on the original issue description and external test case

import { $ } from '../src/$.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function testOriginalIssue() {
  console.log('🧪 Testing original issue #50 scenario\n');

  const tempDir = path.join(os.tmpdir(), `test-original-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  
  const testFile = path.join(tempDir, 'test.txt');
  await fs.promises.writeFile(testFile, 'Test content');
  
  console.log(`Created test directory: ${tempDir}`);
  console.log(`Created test file: ${testFile}`);
  
  try {
    // Initialize git repo (mimic the original test)
    await $({ cwd: tempDir })`git init`;
    console.log('✅ Git repo initialized');
    
    // First test the issue pattern from the description
    console.log('\n--- Testing the issue pattern ---');
    const originalCwd = process.cwd();
    console.log(`Original CWD: ${originalCwd}`);
    
    // This is the failing pattern mentioned in the issue
    console.log('Running: cd /some/directory');
    await $`cd ${tempDir}`;
    console.log(`After cd - Node.js CWD: ${process.cwd()}`);
    
    console.log('Running: pwd');
    const pwdResult = await $`pwd`;
    console.log(`PWD result: ${pwdResult.stdout.trim()}`);
    
    // The issue mentions this should still be in original directory
    if (pwdResult.stdout.trim() === originalCwd) {
      console.log('❌ CONFIRMED: Issue exists - pwd shows original directory');
    } else if (pwdResult.stdout.trim() === tempDir) {
      console.log('✅ UNEXPECTED: pwd shows changed directory - issue might be fixed');
    }
    
    // Reset to original directory for next test
    process.chdir(originalCwd);
    
    // Test the chain pattern  
    console.log('\n--- Testing chain pattern: cd && pwd ---');
    const chainResult = await $`cd ${tempDir} && pwd`;
    console.log(`Chain result: ${chainResult.stdout.trim()}`);
    
    if (chainResult.stdout.trim() === tempDir) {
      console.log('✅ Chain pattern works correctly');
    } else {
      console.log('❌ Chain pattern fails');
    }
    
    // Test git scenario from the original issue
    console.log('\n--- Testing git scenario ---');
    process.chdir(originalCwd); // Start from original
    
    // This should fail according to the issue
    console.log(`Running: cd ${tempDir} && git add test.txt`);
    try {
      const addResult = await $`cd ${tempDir} && git add test.txt`;
      console.log(`Git add exit code: ${addResult.code}`);
      
      // Check git status to see if file was actually added
      const statusResult = await $({ cwd: tempDir })`git status --short`;
      const status = statusResult.stdout.toString().trim();
      console.log(`Git status: "${status}"`);
      
      if (status.includes('??') || status === '') {
        console.log('❌ File still untracked - git add FAILED despite success code!');
      } else if (status.includes('A')) {
        console.log('✅ File was added successfully');
      } else {
        console.log(`ℹ️ Unexpected git status: ${status}`);
      }
    } catch (error) {
      console.log(`Git add failed: ${error.message}`);
    }
    
  } finally {
    // Cleanup
    process.chdir('/tmp/gh-issue-solver-1757436255962'); // Reset to our working dir
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up ${tempDir}`);
  }
}

testOriginalIssue().catch(console.error);