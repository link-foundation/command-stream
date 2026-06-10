#!/usr/bin/env bun
// Test case to reproduce the getcwd() failed error
// This script demonstrates the issue that occurs when the current directory is deleted

import { $ } from '../src/$.mjs';
import fs from 'fs/promises';

const originalDir = process.cwd();

console.log('🧪 Testing getcwd() error scenarios');

async function testGetcwdError() {
  const tempDir = `/tmp/test-getcwd-${Date.now()}`;
  
  try {
    console.log(`📁 Creating temp directory: ${tempDir}`);
    await fs.mkdir(tempDir);
    
    console.log(`📂 Changing to temp directory: ${tempDir}`);
    process.chdir(tempDir);
    
    console.log(`✅ Current directory: ${process.cwd()}`);
    
    // Test 1: Run command while in valid directory
    console.log('\n🔍 Test 1: Running command in valid directory');
    try {
      const result1 = await $`echo "test from valid dir"`;
      console.log(`✅ Command succeeded: ${result1.stdout.trim()}`);
    } catch (error) {
      console.log(`❌ Command failed: ${error.message}`);
    }
    
    // Now delete the directory while we're still in it
    console.log(`\n🗑️  Deleting directory while we're still in it: ${tempDir}`);
    process.chdir('/tmp'); // Move out first to be able to delete
    await fs.rmdir(tempDir);
    
    // Try to go back to the deleted directory
    console.log(`\n📂 Attempting to change to deleted directory: ${tempDir}`);
    try {
      process.chdir(tempDir);
      console.log(`⚠️  Unexpectedly succeeded changing to deleted directory`);
    } catch (error) {
      console.log(`✅ Expected failure changing to deleted directory: ${error.message}`);
    }
    
    // Now let's simulate being stuck in a deleted directory by using a different approach
    console.log(`\n🔍 Test 2: Simulating deleted directory scenario`);
    
    // Create a new temp dir and change to it
    const tempDir2 = `/tmp/test-getcwd-2-${Date.now()}`;
    await fs.mkdir(tempDir2);
    process.chdir(tempDir2);
    
    // Mock process.cwd to throw an error (simulating a deleted directory scenario)
    const originalCwd = process.cwd;
    let cwdCallCount = 0;
    
    // Override process.cwd to fail after first call
    process.cwd = function() {
      cwdCallCount++;
      if (cwdCallCount > 1) {
        const error = new Error('getcwd() failed: No such file or directory');
        error.errno = -2;
        error.code = 'ENOENT';
        throw error;
      }
      return originalCwd.call(this);
    };
    
    try {
      console.log(`📍 First cwd call (should succeed): ${process.cwd()}`);
      console.log(`📍 Second cwd call (should fail): ${process.cwd()}`);
    } catch (error) {
      console.log(`✅ Expected getcwd() error: ${error.message}`);
      
      // Now try to run a command that might trigger the error
      console.log(`\n🔍 Test 3: Running command after getcwd() failure`);
      try {
        const result2 = await $`echo "test after getcwd failure"`;
        console.log(`✅ Command succeeded despite getcwd issue: ${result2.stdout.trim()}`);
      } catch (error) {
        console.log(`❌ Command failed due to getcwd issue: ${error.message}`);
        console.log(`   Stack trace: ${error.stack}`);
      }
    } finally {
      // Restore original process.cwd
      process.cwd = originalCwd;
      process.chdir('/tmp');
      await fs.rmdir(tempDir2).catch(() => {});
    }
    
  } catch (error) {
    console.log(`❌ Test setup error: ${error.message}`);
  } finally {
    // Always restore original directory
    try {
      process.chdir(originalDir);
      console.log(`\n🏠 Restored to original directory: ${originalDir}`);
    } catch (error) {
      console.log(`❌ Failed to restore original directory: ${error.message}`);
    }
  }
}

// Run the test
await testGetcwdError();
console.log('\n✨ Test completed');