import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell } from '../src/$.mjs';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

describe('Git push silent failure fix (Issue #46)', () => {
  let testDir;

  beforeEach(async () => {
    // Create temp directory for each test
    testDir = path.join(tmpdir(), `git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await $`mkdir -p ${testDir}`;
    
    // Initialize git repo
    await $`cd ${testDir} && git init`;
    await $`cd ${testDir} && git config user.email "test@example.com"`;
    await $`cd ${testDir} && git config user.name "Test User"`;
    
    // Create and commit a test file
    await fs.writeFile(path.join(testDir, 'test.txt'), 'Test content');
    await $`cd ${testDir} && git add test.txt`;
    await $`cd ${testDir} && git commit -m "Test commit"`;
    
    // Add non-existent remote
    await $`cd ${testDir} && git remote add origin https://github.com/nonexistent/test-repo.git`;
    
    // Get current branch name
    const branchResult = await $`cd ${testDir} && git branch --show-current`;
    global.testBranch = branchResult.stdout.trim();
  });

  afterEach(async () => {
    if (testDir) {
      try {
        await $`rm -rf ${testDir}`;
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test('git push without redirection should return proper exit code and stderr', async () => {
    const result = await $`cd ${testDir} && git push origin ${global.testBranch}`;
    
    expect(result.code).not.toBe(0); // Should fail
    expect(result.stderr).toContain('fatal:'); // Should have error in stderr
    expect(result.stdout).toBe(''); // stdout should be empty
  });

  test('git push with 2>&1 redirection should return proper exit code and stdout', async () => {
    const result = await $`cd ${testDir} && git push origin ${global.testBranch} 2>&1`;
    
    expect(result.code).not.toBe(0); // Should fail (not return 0 like before the fix)
    expect(result.stdout).toContain('fatal:'); // Error should be in stdout due to redirection
    expect(result.stderr).toBe(''); // stderr should be empty due to redirection
  });

  test('git push with errexit enabled should throw on failure', async () => {
    shell.errexit(true);
    
    try {
      await expect(async () => {
        await $`cd ${testDir} && git push origin ${global.testBranch}`;
      }).toThrow();
    } finally {
      shell.errexit(false);
    }
  });

  test('git push with 2>&1 and errexit should throw on failure', async () => {
    shell.errexit(true);
    
    try {
      await expect(async () => {
        await $`cd ${testDir} && git push origin ${global.testBranch} 2>&1`;
      }).toThrow();
    } finally {
      shell.errexit(false);
    }
  });

  test('complex command with 2>&1 should not trigger virtual cd command bug', async () => {
    // This was the specific case that caused the bug:
    // The command was incorrectly parsed as a virtual `cd` command with all the rest as args
    const result = await $`cd ${testDir} && git push origin ${global.testBranch} 2>&1`;
    
    expect(result.code).not.toBe(0); // Should fail, not return 0 from virtual cd
    expect(result.stdout).toContain('fatal:'); // Should contain actual git error
    expect(result.stdout).not.toContain('cd:'); // Should not contain cd command errors
  });

  test('other shell features that need real shell still work', async () => {
    // Test that other needsRealShell features still work
    const result = await $`cd ${testDir} && echo "test" > output.txt && cat output.txt`;
    
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('test');
  });
});