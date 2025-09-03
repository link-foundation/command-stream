import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  enableVirtualCommands();
});

afterEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

describe('Git and GH commands with cd virtual command', () => {
  describe('Git operations in temp directories', () => {
    let tempDir;
    
    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'git-test-'));
    });
    
    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    test('should initialize git repo after cd to temp directory', async () => {
      const originalCwd = process.cwd();
      
      const cdResult = await $`cd ${tempDir}`;
      expect(cdResult.code).toBe(0);
      
      const initResult = await $`git init`;
      expect(initResult.code).toBe(0);
      // Git init outputs to stderr
      const output = initResult.stdout + initResult.stderr;
      expect(output).toContain('Initialized empty Git repository');
      
      const statusResult = await $`git status`;
      expect(statusResult.code).toBe(0);
      expect(statusResult.stdout).toContain('On branch');
      
      await $`cd ${originalCwd}`;
    });

    test('should handle git commands in temp directory with cd chain', async () => {
      const originalCwd = process.cwd();
      
      // Git init and check status
      const result = await $`cd ${tempDir} && git init && git status --porcelain`;
      expect(result.code).toBe(0);
      // Git init outputs to stderr, check both
      const output = result.stdout + result.stderr;
      expect(output).toContain('Initialized empty Git repository');
      
      await $`cd ${originalCwd}`;
    });

    test('should create and commit files in temp git repo', async () => {
      const originalCwd = process.cwd();
      
      await $`cd ${tempDir}`;
      await $`git init`;
      await $`git config user.email "test@example.com"`;
      await $`git config user.name "Test User"`;
      
      // Use bash -c to properly handle redirection
      await $`bash -c 'echo "test content" > test.txt'`;
      await $`git add test.txt`;
      
      const commitResult = await $`git commit -m "Initial commit"`;
      expect(commitResult.code).toBe(0);
      expect(commitResult.stdout).toContain('1 file changed');
      
      const logResult = await $`git log --oneline`;
      expect(logResult.code).toBe(0);
      expect(logResult.stdout).toContain('Initial commit');
      
      await $`cd ${originalCwd}`;
    });

    test('should handle git branch operations with cd', async () => {
      const originalCwd = process.cwd();
      
      await $`cd ${tempDir} && git init`;
      await $`cd ${tempDir} && git config user.email "test@example.com"`;
      await $`cd ${tempDir} && git config user.name "Test User"`;
      await $`cd ${tempDir} && bash -c 'echo "content" > file.txt' && git add . && git commit -m "init"`;
      
      const branchResult = await $`cd ${tempDir} && git branch --show-current`;
      expect(branchResult.code).toBe(0);
      const defaultBranch = branchResult.stdout.trim();
      expect(['main', 'master']).toContain(defaultBranch);
      
      await $`cd ${tempDir} && git checkout -b feature-branch`;
      
      const newBranchResult = await $`cd ${tempDir} && git branch --show-current`;
      expect(newBranchResult.code).toBe(0);
      expect(newBranchResult.stdout.trim()).toBe('feature-branch');
      
      await $`cd ${originalCwd}`;
    });

    test('should handle multiple temp directories with cd', async () => {
      const tempDir2 = mkdtempSync(join(tmpdir(), 'git-test2-'));
      const originalCwd = process.cwd();
      
      try {
        await $`cd ${tempDir} && git init && bash -c 'echo "repo1" > file.txt'`;
        await $`cd ${tempDir2} && git init && bash -c 'echo "repo2" > file.txt'`;
        
        const repo1Content = await $`cd ${tempDir} && cat file.txt`;
        expect(repo1Content.stdout.trim()).toBe('repo1');
        
        const repo2Content = await $`cd ${tempDir2} && cat file.txt`;
        expect(repo2Content.stdout.trim()).toBe('repo2');
        
        const repo1Status = await $`cd ${tempDir} && git status --porcelain`;
        expect(repo1Status.stdout).toContain('file.txt');
        
        const repo2Status = await $`cd ${tempDir2} && git status --porcelain`;
        expect(repo2Status.stdout).toContain('file.txt');
      } finally {
        rmSync(tempDir2, { recursive: true, force: true });
        await $`cd ${originalCwd}`;
      }
    });

    test('should handle git diff operations after cd', async () => {
      const originalCwd = process.cwd();
      
      await $`cd ${tempDir} && git init`;
      await $`cd ${tempDir} && git config user.email "test@example.com"`;
      await $`cd ${tempDir} && git config user.name "Test User"`;
      await $`cd ${tempDir} && bash -c 'echo "line1" > file.txt' && git add . && git commit -m "first"`;
      await $`cd ${tempDir} && bash -c 'echo "line2" >> file.txt'`;
      
      const diffResult = await $`cd ${tempDir} && git diff`;
      expect(diffResult.code).toBe(0);
      expect(diffResult.stdout).toContain('+line2');
      
      const statusResult = await $`cd ${tempDir} && git status --porcelain`;
      expect(statusResult.stdout).toContain(' M file.txt');
      
      await $`cd ${originalCwd}`;
    });

    test('should work with git in subshells', async () => {
      const originalCwd = process.cwd();
      
      // Initialize repo in subshell - should not affect parent
      await $`(cd ${tempDir} && git init && git config user.email "test@example.com")`;
      
      // Verify we're still in original directory
      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(originalCwd);
      
      // But the repo should exist
      const checkResult = await $`cd ${tempDir} && git status`;
      expect(checkResult.code).toBe(0);
      
      await $`cd ${originalCwd}`;
    });
  });

  describe('GH CLI operations with cd', () => {
    test('should check gh auth status', async () => {
      const result = await $`gh auth status`;
      // This might fail if not authenticated, but we're testing the command execution
      expect([0, 1]).toContain(result.code);
      
      if (result.code === 0) {
        expect(result.stdout.toLowerCase()).toMatch(/logged in|authenticated/i);
      } else {
        expect(result.stderr.toLowerCase()).toMatch(/not.*authenticated|not.*logged/i);
      }
    });

    test('should handle gh api calls with cd to temp directory', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'gh-test-'));
      const originalCwd = process.cwd();
      
      try {
        await $`cd ${tempDir}`;
        
        const result = await $`gh api user --jq .login 2>/dev/null || echo "not-authenticated"`;
        expect(result.code).toBe(0);
        // Result will be either a username or "not-authenticated"
        expect(result.stdout.trim().length).toBeGreaterThan(0);
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should simulate gh repo clone pattern', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'gh-clone-'));
      const originalCwd = process.cwd();
      
      try {
        // Simulate the pattern from solve.mjs without actually cloning
        const owner = 'octocat';
        const repo = 'Hello-World';
        
        await $`cd ${tempDir}`;
        
        // Test the command structure (use -- to separate git flags as per gh documentation)
        const cloneCmd = `gh repo clone ${owner}/${repo} . -- --depth 1 2>&1 || echo "Clone would execute here"`;
        const result = await $`bash -c ${cloneCmd}`;
        expect(result.code).toBe(0);
        
        // Test that we're in the right directory
        const pwdResult = await $`pwd`;
        expect(pwdResult.stdout.trim()).toBe(tempDir);
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should handle gh commands with directory context', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'gh-context-'));
      const originalCwd = process.cwd();
      
      try {
        // Create a mock git repo structure
        await $`cd ${tempDir} && git init`;
        await $`cd ${tempDir} && git config user.email "test@example.com"`;
        await $`cd ${tempDir} && git config user.name "Test User"`;
        await $`cd ${tempDir} && bash -c 'echo "# Test Repo" > README.md'`;
        await $`cd ${tempDir} && git add . && git commit -m "Initial commit"`;
        
        // Test gh command patterns that would work in a repo context
        const statusResult = await $`cd ${tempDir} && git status --porcelain`;
        expect(statusResult.code).toBe(0);
        expect(statusResult.stdout).toBe('');
        
        // Simulate checking for existing PRs (would fail without actual remote)
        const prListCmd = await $`cd ${tempDir} && gh pr list --limit 1 2>&1 || echo "No remote configured"`;
        expect(prListCmd.code).toBe(0);
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Combined git and gh workflows', () => {
    test('should simulate solve.mjs workflow pattern', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'workflow-'));
      const originalCwd = process.cwd();
      
      try {
        // Step 1: Navigate to temp directory
        await $`cd ${tempDir}`;
        
        // Step 2: Initialize git repo (simulating clone)
        await $`git init`;
        await $`git config user.email "bot@example.com"`;
        await $`git config user.name "Bot User"`;
        
        // Step 3: Check current branch
        const branchResult = await $`git branch --show-current`;
        const currentBranch = branchResult.stdout.trim() || 'master';
        
        // Step 4: Create new feature branch
        const branchName = `feature-${Date.now()}`;
        await $`git checkout -b ${branchName}`;
        
        // Step 5: Verify branch switch
        const newBranchResult = await $`git branch --show-current`;
        expect(newBranchResult.stdout.trim()).toBe(branchName);
        
        // Step 6: Make changes
        await $`bash -c 'echo "feature implementation" > feature.js'`;
        await $`git add .`;
        
        // Step 7: Check status
        const statusResult = await $`git status --porcelain`;
        expect(statusResult.stdout.trim()).toMatch(/A.*feature\.js/);
        
        // Step 8: Commit changes
        await $`git commit -m "Add feature implementation"`;
        
        // Step 9: Verify commit
        const logResult = await $`git log --oneline -1`;
        expect(logResult.stdout).toContain('Add feature implementation');
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should handle error scenarios with cd and git', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'error-test-'));
      const originalCwd = process.cwd();
      
      try {
        // Test invalid git command in temp directory
        await $`cd ${tempDir}`;
        // Git status will fail in non-git directory
        const result = await $`git status 2>&1 || echo "not a git repo"`;
        const output = result.stdout + result.stderr;
        expect(output.toLowerCase()).toMatch(/not a git repo|fatal.*not a git repository/);
        
        // Test recovery after error
        await $`git init`;
        const retryResult = await $`git status`;
        expect(retryResult.code).toBe(0);
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should preserve cwd after command chains', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'cwd-test-'));
      const originalCwd = process.cwd();
      
      try {
        // Run commands with cd in subshell
        await $`(cd ${tempDir} && git init && echo 'test' > file.txt)`;
        
        // Verify we're still in original directory
        const currentDir = await $`pwd`;
        expect(currentDir.stdout.trim()).toBe(originalCwd);
        
        // Verify the commands actually ran in temp directory
        const checkResult = await $`cd ${tempDir} && test -f file.txt && echo "exists"`;
        expect(checkResult.stdout.trim()).toBe('exists');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('should work with complex git workflows using operators', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'complex-'));
      const originalCwd = process.cwd();
      
      try {
        // Complex workflow with &&, ||, and ;
        const result = await $`cd ${tempDir} && git init && git config user.email "test@test.com" && git config user.name "Test" ; echo "setup done"`;
        expect(result.stdout).toContain('setup done');
        
        // Use || for error handling - git remote add returns 0 even for non-existent URLs
        const errorHandling = await $`cd ${tempDir} && git remote get-url nonexistent 2>/dev/null || echo "remote failed as expected"`;
        expect(errorHandling.stdout).toContain('remote failed as expected');
        
        // Complex chain with file operations
        await $`cd ${tempDir} && echo "test" > file1.txt && git add . && git commit -m "test" && echo "committed"`;
        
        const logCheck = await $`cd ${tempDir} && git log --oneline`;
        expect(logCheck.stdout).toContain('test');
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Path resolution and quoting with cd', () => {
    test('should handle paths with spaces in git operations', async () => {
      const baseTempDir = mkdtempSync(join(tmpdir(), 'space-test-'));
      const tempDirWithSpace = join(baseTempDir, 'my test dir');
      const originalCwd = process.cwd();
      
      try {
        await $`mkdir -p ${tempDirWithSpace}`;
        await $`cd ${tempDirWithSpace} && git init`;
        
        const pwdResult = await $`cd ${tempDirWithSpace} && pwd`;
        expect(pwdResult.stdout.trim()).toBe(tempDirWithSpace);
        
        // Test git operations in directory with spaces
        await $`cd ${tempDirWithSpace} && git config user.email "test@test.com"`;
        await $`cd ${tempDirWithSpace} && bash -c 'echo "test" > file.txt' && git add . && git commit -m "test"`;
        
        const logResult = await $`cd ${tempDirWithSpace} && git log --oneline`;
        expect(logResult.stdout).toContain('test');
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(baseTempDir, { recursive: true, force: true });
      }
    });

    test('should handle special characters in paths', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'special-chars-'));
      const specialDir = join(tempDir, "test-'dir'-$1");
      const originalCwd = process.cwd();
      
      try {
        await $`mkdir -p ${specialDir}`;
        await $`cd ${specialDir} && git init`;
        
        const statusResult = await $`cd ${specialDir} && git status`;
        expect(statusResult.code).toBe(0);
        
        await $`cd ${originalCwd}`;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});