#!/usr/bin/env node

// Test to compare command-stream vs native execSync for git push
import { $ } from '../src/$.mjs';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

async function testGitPushOutputComparison() {
  console.log('🔧 Comparing command-stream vs execSync for git operations...\n');
  
  // Create a temporary directory for testing
  const testDir = path.join(tmpdir(), `git-output-test-${Date.now()}`);
  
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
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Test content for git push issue');
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Test commit"`;
    
    // Add a remote (this one doesn't exist, so push will fail)
    await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/test-repo.git`;
    
    console.log('\n🔍 Test 1: Using command-stream $ for git push...');
    try {
      const commandStreamResult = await $`cd ${testDir} && git push -u origin main 2>&1`;
      console.log('Command-stream results:');
      console.log('  Exit code:', commandStreamResult.code);
      console.log('  Stdout length:', commandStreamResult.stdout?.length || 0);
      console.log('  Stderr length:', commandStreamResult.stderr?.length || 0);
      console.log('  Stdout:', JSON.stringify(commandStreamResult.stdout || ''));
      console.log('  Stderr:', JSON.stringify(commandStreamResult.stderr || ''));
    } catch (error) {
      console.log('❌ Command-stream threw error:', error.message);
      console.log('  Error code:', error.code);
    }
    
    console.log('\n🔍 Test 2: Using execSync for git push...');
    try {
      const execSyncOutput = execSync('git push -u origin main 2>&1', {
        encoding: 'utf8',
        cwd: testDir
      });
      console.log('ExecSync results:');
      console.log('  Output length:', execSyncOutput.length);
      console.log('  Output:', JSON.stringify(execSyncOutput));
    } catch (error) {
      console.log('❌ ExecSync threw error (expected):', error.message.split('\n')[0]);
      console.log('  Exit code:', error.status);
      console.log('  Error output:', JSON.stringify(error.output?.toString() || error.stdout?.toString() || ''));
    }
    
    // Test with dry-run which shouldn't fail
    console.log('\n🔍 Test 3: Using command-stream $ for git push --dry-run...');
    try {
      const dryRunResult = await $`cd ${testDir} && git push --dry-run origin main 2>&1`;
      console.log('Command-stream dry-run results:');
      console.log('  Exit code:', dryRunResult.code);
      console.log('  Stdout length:', dryRunResult.stdout?.length || 0);
      console.log('  Stderr length:', dryRunResult.stderr?.length || 0);
      console.log('  Stdout:', JSON.stringify(dryRunResult.stdout || ''));
      console.log('  Stderr:', JSON.stringify(dryRunResult.stderr || ''));
    } catch (error) {
      console.log('❌ Command-stream dry-run threw error:', error.message);
    }
    
    console.log('\n🔍 Test 4: Using execSync for git push --dry-run...');
    try {
      const execSyncDryRun = execSync('git push --dry-run origin main 2>&1', {
        encoding: 'utf8',
        cwd: testDir
      });
      console.log('ExecSync dry-run results:');
      console.log('  Output length:', execSyncDryRun.length);
      console.log('  Output:', JSON.stringify(execSyncDryRun));
    } catch (error) {
      console.log('❌ ExecSync dry-run threw error:', error.message.split('\n')[0]);
      console.log('  Output:', JSON.stringify(error.output?.toString() || error.stdout?.toString() || ''));
    }
    
    // Test a successful git command for comparison
    console.log('\n🔍 Test 5: Git status comparison...');
    const statusCommand = await $`cd ${testDir} && git status`;
    console.log('Command-stream git status:');
    console.log('  Exit code:', statusCommand.code);
    console.log('  Stdout length:', statusCommand.stdout?.length || 0);
    console.log('  Stdout preview:', (statusCommand.stdout || '').slice(0, 100));
    
    const statusExecSync = execSync('git status', { encoding: 'utf8', cwd: testDir });
    console.log('ExecSync git status:');
    console.log('  Output length:', statusExecSync.length);
    console.log('  Output preview:', statusExecSync.slice(0, 100));
    
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
testGitPushOutputComparison().catch(console.error);