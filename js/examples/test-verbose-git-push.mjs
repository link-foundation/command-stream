#!/usr/bin/env node

// Test git push with verbose logging to trace execution
import { $ } from '../src/$.mjs';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

// Enable verbose logging
process.env.COMMAND_STREAM_VERBOSE = 'true';

async function testVerboseGitPush() {
  console.log('🔧 Testing git push with verbose logging enabled...\n');
  
  // Create a temporary directory for testing
  const testDir = path.join(tmpdir(), `verbose-git-test-${Date.now()}`);
  
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
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Test content');
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Test commit"`;
    
    // Check which branch we're on
    const branchResult = await $`cd ${testDir} && git branch --show-current`;
    const branch = branchResult.stdout.trim();
    console.log('Current branch:', branch);
    
    // Add a remote that doesn't exist
    await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/test-repo.git`;
    
    console.log('\n🔍 Test 1: git push without redirection (verbose logging enabled)...');
    console.log('='.repeat(80));
    const pushResult1 = await $`cd ${testDir} && git push -u origin ${branch}`;
    console.log('='.repeat(80));
    console.log('Results:');
    console.log('  Exit code:', pushResult1.code);
    console.log('  Stdout:', JSON.stringify(pushResult1.stdout || ''));
    console.log('  Stderr:', JSON.stringify(pushResult1.stderr || ''));
    
    console.log('\n🔍 Test 2: git push WITH 2>&1 redirection (verbose logging enabled)...');
    console.log('='.repeat(80));
    const pushResult2 = await $`cd ${testDir} && git push -u origin ${branch} 2>&1`;
    console.log('='.repeat(80));
    console.log('Results:');
    console.log('  Exit code:', pushResult2.code);
    console.log('  Stdout:', JSON.stringify(pushResult2.stdout || ''));
    console.log('  Stderr:', JSON.stringify(pushResult2.stderr || ''));
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('Error stack:', error.stack);
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
testVerboseGitPush().catch(console.error);