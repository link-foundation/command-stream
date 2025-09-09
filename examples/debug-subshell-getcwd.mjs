#!/usr/bin/env bun
// Test case to reproduce the getcwd() failed error in subshells
// This targets the specific code path in _runSubshell that saves cwd

import { $ } from '../src/$.mjs';
import fs from 'fs/promises';

const originalDir = process.cwd();

console.log('🧪 Testing getcwd() error in subshell scenarios');

async function testSubshellGetcwdError() {
  const tempDir = `/tmp/test-subshell-${Date.now()}`;
  
  try {
    console.log(`📁 Creating temp directory: ${tempDir}`);
    await fs.mkdir(tempDir);
    process.chdir(tempDir);
    
    // Test with subshell command that should trigger _runSubshell
    console.log(`\n🔍 Test 1: Running subshell command in valid directory`);
    try {
      const result1 = await $`(echo "subshell test")`;
      console.log(`✅ Subshell command succeeded: ${result1.stdout.trim()}`);
    } catch (error) {
      console.log(`❌ Subshell command failed: ${error.message}`);
    }
    
    // Now simulate the getcwd() failure scenario
    const originalCwd = process.cwd;
    
    // Override process.cwd to fail when called from _runSubshell
    process.cwd = function() {
      const stack = new Error().stack;
      if (stack.includes('_runSubshell')) {
        const error = new Error('getcwd() failed: No such file or directory');
        error.errno = -2;
        error.code = 'ENOENT';
        throw error;
      }
      return originalCwd.call(this);
    };
    
    console.log(`\n🔍 Test 2: Running subshell command with getcwd() failure`);
    try {
      const result2 = await $`(echo "subshell with getcwd failure")`;
      console.log(`✅ Subshell command succeeded despite getcwd failure: ${result2.stdout.trim()}`);
    } catch (error) {
      console.log(`❌ Subshell command failed due to getcwd failure: ${error.message}`);
      console.log(`   Stack trace: ${error.stack}`);
    } finally {
      // Restore original process.cwd
      process.cwd = originalCwd;
    }
    
    // Test with command sequence that might use subshells
    console.log(`\n🔍 Test 3: Running command sequence`);
    try {
      process.cwd = function() {
        const stack = new Error().stack;
        if (stack.includes('_runSubshell') || stack.includes('savedCwd')) {
          const error = new Error('getcwd() failed: No such file or directory');
          error.errno = -2;
          error.code = 'ENOENT';
          throw error;
        }
        return originalCwd.call(this);
      };
      
      const result3 = await $`echo "first"; echo "second"`;
      console.log(`✅ Command sequence succeeded: ${result3.stdout.trim()}`);
    } catch (error) {
      console.log(`❌ Command sequence failed: ${error.message}`);
      console.log(`   Stack trace: ${error.stack}`);
    } finally {
      process.cwd = originalCwd;
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
await testSubshellGetcwdError();
console.log('\n✨ Test completed');