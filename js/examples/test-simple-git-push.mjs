#!/usr/bin/env node

// Test to isolate the git push issue without redirection
import { $ } from '../src/$.mjs';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

async function testSimpleGitPush() {
  console.log('🔧 Testing simple git push without redirection...\n');
  
  // Create a temporary directory for testing
  const testDir = path.join(tmpdir(), `simple-git-test-${Date.now()}`);
  
  try {
    console.log(`📁 Creating test directory: ${testDir}`);
    await $`mkdir -p ${testDir}`;
    
    // Initialize git repository
    console.log('🔄 Initializing git repository...');
    await $`cd ${testDir} && git init`;
    
    // Configure git user (required for commits)
    await $`cd ${testDir} && git config user.email "test@example.com"`;
    await $`cd ${testDir} && git config user.name "Test User"`;
    
    // Create a test file and commit to the correct branch
    console.log('📝 Creating test file and committing...');
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Test content');
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Test commit"`;
    
    // Check which branch we're on
    const branchResult = await $`cd ${testDir} && git branch --show-current`;
    console.log('Current branch:', branchResult.stdout.trim());
    
    // Add a remote that doesn't exist
    await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/test-repo.git`;
    
    console.log('\n🔍 Test 1: git push without redirection...');
    const pushResult = await $`cd ${testDir} && git push -u origin ${branchResult.stdout.trim()}`;
    console.log('Results:');
    console.log('  Exit code:', pushResult.code);
    console.log('  Stdout length:', pushResult.stdout?.length || 0);
    console.log('  Stderr length:', pushResult.stderr?.length || 0);
    console.log('  Stdout:', JSON.stringify(pushResult.stdout || ''));
    console.log('  Stderr:', JSON.stringify(pushResult.stderr || ''));
    
    console.log('\n🔍 Test 2: git push with explicit 2>&1 redirection...');
    const pushRedirectResult = await $`cd ${testDir} && git push -u origin ${branchResult.stdout.trim()} 2>&1`;
    console.log('Results:');
    console.log('  Exit code:', pushRedirectResult.code);
    console.log('  Stdout length:', pushRedirectResult.stdout?.length || 0);
    console.log('  Stderr length:', pushRedirectResult.stderr?.length || 0);
    console.log('  Stdout:', JSON.stringify(pushRedirectResult.stdout || ''));
    console.log('  Stderr:', JSON.stringify(pushRedirectResult.stderr || ''));
    
    console.log('\n🔍 Test 3: git push to a different fake remote...');
    await $`cd ${testDir} && git remote set-url origin https://fake-host-that-does-not-exist.com/repo.git`;
    const pushFakeResult = await $`cd ${testDir} && git push origin ${branchResult.stdout.trim()}`;
    console.log('Results:');
    console.log('  Exit code:', pushFakeResult.code);
    console.log('  Stdout length:', pushFakeResult.stdout?.length || 0);
    console.log('  Stderr length:', pushFakeResult.stderr?.length || 0);
    console.log('  Stdout:', JSON.stringify(pushFakeResult.stdout || ''));
    console.log('  Stderr:', JSON.stringify(pushFakeResult.stderr || ''));
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
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
testSimpleGitPush().catch(console.error);