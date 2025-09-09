#!/usr/bin/env node

// Test script to reproduce git push silent failure issue
import { $ } from '../src/$.mjs';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

async function testGitPushSilentFailure() {
  console.log('🔧 Testing git push silent failure issue...\n');
  
  // Create a temporary directory for testing
  const testDir = path.join(tmpdir(), `git-push-test-${Date.now()}`);
  
  try {
    console.log(`📁 Creating test directory: ${testDir}`);
    await $`mkdir -p ${testDir}`;
    
    // Initialize git repository
    console.log('🔄 Initializing git repository...');
    await $`cd ${testDir} && git init`;
    
    // Configure git user (required for commits)
    await $`cd ${testDir} && git config user.email "test@example.com"`;
    await $`cd ${testDir} && git config user.name "Test User"`;
    
    // Create a test file and commit
    console.log('📝 Creating test file and committing...');
    await $`cd ${testDir} && echo "test content" > test.txt`;
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Initial commit"`;
    
    // Test 1: Try to push to a non-existent remote (this should fail)
    console.log('\n🔍 Test 1: Pushing to non-existent remote...');
    try {
      const result = await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/repo.git`;
      console.log('✅ Remote added successfully');
      
      const pushResult = await $`cd ${testDir} && git push -u origin main`;
      console.log('🚨 POTENTIAL ISSUE: Push appeared successful when it should have failed!');
      console.log('Exit code:', pushResult.code);
      console.log('Stdout:', pushResult.stdout);
      console.log('Stderr:', pushResult.stderr);
      
    } catch (error) {
      console.log('✅ Push correctly failed with error:', error.message);
      console.log('Error code:', error.code);
    }
    
    // Test 2: Try to push to an invalid URL
    console.log('\n🔍 Test 2: Pushing to invalid URL...');
    try {
      await $`cd ${testDir} && git remote set-url origin https://invalid-url-that-does-not-exist.com/repo.git`;
      const pushResult = await $`cd ${testDir} && git push origin main`;
      console.log('🚨 POTENTIAL ISSUE: Push to invalid URL appeared successful!');
      console.log('Exit code:', pushResult.code);
      console.log('Stdout:', pushResult.stdout);
      console.log('Stderr:', pushResult.stderr);
      
    } catch (error) {
      console.log('✅ Push to invalid URL correctly failed:', error.message);
      console.log('Error code:', error.code);
    }
    
    // Test 3: Check git status after failed push
    console.log('\n🔍 Test 3: Checking git status after push attempt...');
    const statusResult = await $`cd ${testDir} && git status`;
    console.log('Git status output:');
    console.log(statusResult.stdout);
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('Error details:', error);
  } finally {
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
testGitPushSilentFailure().catch(console.error);