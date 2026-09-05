#!/usr/bin/env node

// Test script to reproduce git push silent failure with errexit enabled
import { $, shell } from '../src/$.mjs';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

async function testGitPushWithReachExit() {
  console.log('🔧 Testing git push with errexit enabled...\n');
  
  // Create a temporary directory for testing
  const testDir = path.join(tmpdir(), `git-push-errexit-test-${Date.now()}`);
  
  try {
    console.log(`📁 Creating test directory: ${testDir}`);
    await $`mkdir -p ${testDir}`;
    
    // Initialize git repository
    console.log('🔄 Initializing git repository...');
    await $`cd ${testDir} && git init`;
    
    // Configure git user (required for commits)
    await $`cd ${testDir} && git config user.email "test@example.com"`;
    await $`cd ${testDir} && git config user.name "Test User"`;
    
    // Create a test file and commit to main branch
    console.log('📝 Creating test file and committing to main...');
    await $`cd ${testDir} && git checkout -b main`;
    await $`cd ${testDir} && echo "test content" > test.txt`;
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Initial commit"`;
    
    console.log('\n🔧 Test without errexit (default behavior)...');
    shell.errexit(false);
    try {
      const result = await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/repo.git`;
      const pushResult = await $`cd ${testDir} && git push -u origin main`;
      console.log('✅ Command executed without throwing');
      console.log('Exit code:', pushResult.code);
      console.log('Stderr length:', pushResult.stderr?.length || 0);
      console.log('Has error in stderr:', pushResult.stderr?.includes('error:') || false);
    } catch (error) {
      console.log('❌ Command threw error (unexpected):', error.message);
    }
    
    console.log('\n🔧 Test with errexit enabled...');
    shell.errexit(true);
    try {
      const pushResult = await $`cd ${testDir} && git push origin main`;
      console.log('🚨 Command completed without throwing (this is the bug!)');
      console.log('Exit code:', pushResult.code);
      console.log('Stderr:', pushResult.stderr);
    } catch (error) {
      console.log('✅ Command correctly threw error:', error.message);
      console.log('Error code:', error.code);
    }
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('Error details:', error);
  } finally {
    // Reset errexit
    shell.errexit(false);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test directory...');
    try {
      await $`rm -rf ${testDir}`;
      console.log('✅ Cleanup completed');
    } catch (cleanupError) {
      console.log('⚠️ Cleanup failed:', cleanupError.message);
    }
  }
}

// Run the test
testGitPushWithReachExit().catch(console.error);