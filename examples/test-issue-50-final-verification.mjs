#!/usr/bin/env node
// Final verification test for Issue #50: CWD with CD pattern failure
// This test verifies that the issue described in #50 has been resolved

import { $ } from '../src/$.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('🔍 Issue #50 Final Verification Test');
console.log('====================================\n');

async function testIssueScenarios() {
  const results = [];
  
  // Test helper
  const test = async (name, testFn) => {
    try {
      await testFn();
      results.push({ name, status: '✅ PASS' });
      console.log(`✅ ${name}`);
    } catch (error) {
      results.push({ name, status: '❌ FAIL', error: error.message });
      console.log(`❌ ${name}: ${error.message}`);
    }
  };

  const tempDir = path.join(os.tmpdir(), `issue-50-final-${Date.now()}`);
  const originalCwd = process.cwd();

  try {
    // Create test environment
    await fs.promises.mkdir(tempDir, { recursive: true });
    const testFile = path.join(tempDir, 'test.txt');
    await fs.promises.writeFile(testFile, 'Test content for issue #50');

    console.log(`📁 Test directory: ${tempDir}`);
    console.log(`📝 Test file: ${testFile}\n`);

    // Test 1: The original failing pattern from issue description
    await test('Original failing pattern: cd /some/directory && pwd', async () => {
      process.chdir(originalCwd);
      
      const result = await $`cd ${tempDir} && pwd`;
      const actualDir = result.stdout.trim();
      
      if (actualDir !== tempDir) {
        throw new Error(`Expected ${tempDir}, got ${actualDir}`);
      }
      
      // Verify Node.js CWD also changed
      if (process.cwd() !== tempDir) {
        throw new Error(`Node.js CWD should be ${tempDir}, but is ${process.cwd()}`);
      }
    });

    // Test 2: Separate commands pattern
    await test('Separate commands should maintain directory', async () => {
      process.chdir(originalCwd);
      
      await $`cd ${tempDir}`;
      const pwdResult = await $`pwd`;
      
      if (pwdResult.stdout.trim() !== tempDir) {
        throw new Error(`Expected ${tempDir}, got ${pwdResult.stdout.trim()}`);
      }
    });

    // Test 3: Git scenario from the external test reference
    await test('Git scenario: cd && git operations', async () => {
      // Initialize git repo
      await $({ cwd: tempDir })`git init`;
      
      process.chdir(originalCwd);
      
      // This was the failing pattern mentioned in the issue
      const addResult = await $`cd ${tempDir} && git add test.txt`;
      
      if (addResult.code !== 0) {
        throw new Error(`git add failed with code ${addResult.code}`);
      }
      
      // Verify file was actually staged
      const statusResult = await $({ cwd: tempDir })`git status --short`;
      const status = statusResult.stdout.toString().trim();
      
      if (!status.includes('A  test.txt')) {
        throw new Error(`File not staged correctly. Status: "${status}"`);
      }
    });

    // Test 4: Complex directory chain operations
    await test('Complex chain: cd && mkdir && cd && pwd', async () => {
      process.chdir(originalCwd);
      
      const subDir = path.join(tempDir, 'subdir');
      const result = await $`cd ${tempDir} && mkdir -p subdir && cd subdir && pwd`;
      
      if (result.stdout.trim() !== subDir) {
        throw new Error(`Expected ${subDir}, got ${result.stdout.trim()}`);
      }
    });

    // Test 5: Verify error handling
    await test('Error handling: cd to non-existent directory', async () => {
      process.chdir(originalCwd);
      
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const result = await $`cd ${nonExistent} && echo "should not execute"`;
      
      if (result.code === 0) {
        throw new Error('Expected command to fail when cd to non-existent directory');
      }
      
      // Should remain in original directory
      if (process.cwd() !== originalCwd) {
        throw new Error(`CWD should remain ${originalCwd}, but is ${process.cwd()}`);
      }
    });

    // Test 6: Build scenario simulation
    await test('Build scenario: cd && compile operations', async () => {
      process.chdir(originalCwd);
      
      // Simulate a build process
      const buildResult = await $`cd ${tempDir} && echo "Compiling..." && ls test.txt && echo "Build complete"`;
      
      if (buildResult.code !== 0) {
        throw new Error('Build simulation failed');
      }
      
      if (!buildResult.stdout.includes('Compiling...') || 
          !buildResult.stdout.includes('test.txt') || 
          !buildResult.stdout.includes('Build complete')) {
        throw new Error('Build output incomplete');
      }
    });

  } finally {
    // Cleanup
    process.chdir(originalCwd);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary:');
  const passed = results.filter(r => r.status.includes('PASS')).length;
  const failed = results.filter(r => r.status.includes('FAIL')).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / results.length) * 100)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => r.status.includes('FAIL')).forEach(r => {
      console.log(`   • ${r.name}: ${r.error}`);
    });
  }

  console.log('\n🎉 Conclusion:');
  if (failed === 0) {
    console.log('Issue #50 has been RESOLVED! All CD patterns work correctly.');
    console.log('The virtual cd command properly maintains directory context across');
    console.log('shell operator chains (&&, ||, ;) as expected.');
  } else {
    console.log('Issue #50 still exists. Some CD patterns are not working correctly.');
  }

  return failed === 0;
}

// Run the verification
testIssueScenarios()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  });