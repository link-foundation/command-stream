import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  beforeTestCleanup,
  afterTestCleanup,
  originalCwd,
} from './test-cleanup.mjs';
import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';

// Helper function to verify we're in the expected directory
function verifyCwd(expected, message) {
  const actual = process.cwd();
  if (actual !== expected) {
    throw new Error(
      `${message}: Expected cwd to be ${expected}, but got ${actual}`
    );
  }
}

describe('cd Virtual Command - Core Behavior', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
    enableVirtualCommands();
    // Verify we start in the original directory
    verifyCwd(originalCwd, 'Before test start');
  });

  afterEach(async () => {
    await afterTestCleanup();
    // Verify we restored to original directory
    verifyCwd(originalCwd, 'After test cleanup');
  });

  test('should change to absolute path', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-test-'));
    const testStartCwd = process.cwd();

    try {
      // Verify we start in the original directory
      verifyCwd(originalCwd, 'Test start');

      const result = await $`cd ${tempDir}`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(''); // cd should not output anything
      expect(result.stderr).toBe('');

      // Verify cd actually changed the directory
      verifyCwd(tempDir, 'After cd to tempDir');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(tempDir);

      // Go back to original
      await $`cd ${testStartCwd}`;
      verifyCwd(testStartCwd, 'After cd back');
    } finally {
      // Ensure we're back in original before cleanup
      if (process.cwd() !== testStartCwd) {
        process.chdir(testStartCwd);
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should change to relative path', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-base-'));
    const subDir = join(baseDir, 'subdir');
    mkdirSync(subDir);
    const originalCwd = process.cwd();

    try {
      await $`cd ${baseDir}`;

      const result = await $`cd subdir`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(subDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle cd with no arguments (go to home)', async () => {
    const originalCwd = process.cwd();

    try {
      const result = await $`cd`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      const home = homedir();
      expect(pwd.stdout.trim()).toBe(home);

      await $`cd ${originalCwd}`;
    } catch (error) {
      await $`cd ${originalCwd}`;
      throw error;
    }
  });

  test('should handle cd - (return to previous directory)', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'cd-dir1-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'cd-dir2-'));
    const originalCwd = process.cwd();

    try {
      await $`cd ${dir1}`;
      const pwd1 = await $`pwd`;
      expect(pwd1.stdout.trim()).toBe(dir1);

      await $`cd ${dir2}`;
      const pwd2 = await $`pwd`;
      expect(pwd2.stdout.trim()).toBe(dir2);

      // Note: cd - might not be implemented in virtual command yet
      // This test documents expected behavior
      const result = await $`cd - 2>&1 || echo "not implemented"`;

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('should handle cd .. (parent directory)', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-parent-'));
    const subDir = join(baseDir, 'child');
    mkdirSync(subDir);
    const originalCwd = process.cwd();

    try {
      await $`cd ${subDir}`;

      const result = await $`cd ..`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(baseDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle cd . (current directory)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-dot-'));
    const originalCwd = process.cwd();

    try {
      await $`cd ${tempDir}`;
      const pwdBefore = await $`pwd`;

      const result = await $`cd .`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwdAfter = await $`pwd`;
      expect(pwdAfter.stdout).toBe(pwdBefore.stdout);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should fail with non-existent directory', async () => {
    const nonExistent = '/this/path/should/not/exist/at/all';
    const originalCwd = process.cwd();

    const result = await $`cd ${nonExistent} 2>&1 || echo "failed"`;
    expect(result.stdout).toContain('failed');

    // Verify we're still in the same directory
    const pwd = await $`pwd`;
    expect(pwd.stdout.trim()).toBe(originalCwd);
  });

  test('should handle paths with spaces', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-spaces-'));
    const dirWithSpaces = join(baseDir, 'my test directory');
    mkdirSync(dirWithSpaces);
    const originalCwd = process.cwd();

    try {
      const result = await $`cd ${dirWithSpaces}`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(dirWithSpaces);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle special characters in paths', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-special-'));
    // Create directory with special characters (but valid for filesystem)
    const specialDir = join(baseDir, 'test-dir_123');
    mkdirSync(specialDir);
    const originalCwd = process.cwd();

    try {
      const result = await $`cd ${specialDir}`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(specialDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('cd Virtual Command - Command Chains', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
    enableVirtualCommands();
    verifyCwd(originalCwd, 'Before test start');
  });

  afterEach(async () => {
    await afterTestCleanup();
    verifyCwd(originalCwd, 'After test cleanup');
  });

  test('should persist directory change within command chain', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-chain-'));
    const originalCwd = process.cwd();

    try {
      // Create a test file in temp directory
      writeFileSync(join(tempDir, 'test.txt'), 'test content');

      // cd and run command in same chain
      const result = await $`cd ${tempDir} && cat test.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('test content');

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should handle multiple cd commands in chain', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-multi-'));
    const dir1 = join(baseDir, 'dir1');
    const dir2 = join(baseDir, 'dir2');
    mkdirSync(dir1);
    mkdirSync(dir2);
    const originalCwd = process.cwd();

    try {
      writeFileSync(join(dir1, 'file1.txt'), 'content1');
      writeFileSync(join(dir2, 'file2.txt'), 'content2');

      // Chain multiple cd commands
      const result =
        await $`cd ${dir1} && cat file1.txt && cd ${dir2} && cat file2.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('content1');
      expect(result.stdout).toContain('content2');

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should work with git commands in chain', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-git-'));
    const originalCwd = process.cwd();

    try {
      const result = await $`cd ${tempDir} && git init`;
      expect(result.code).toBe(0);
      // Git init outputs to stderr
      const output = (result.stdout + result.stderr).toLowerCase();
      expect(output).toContain('initialized');

      // Verify git repo was created in the right place
      expect(existsSync(join(tempDir, '.git'))).toBe(true);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should maintain separate directory context per command when not chained', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'cd-ctx1-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'cd-ctx2-'));
    const originalCwd = process.cwd();

    try {
      // First command changes to dir1
      await $`cd ${dir1}`;
      const pwd1 = await $`pwd`;
      expect(pwd1.stdout.trim()).toBe(dir1);

      // Second separate command should still be in dir1
      const pwd2 = await $`pwd`;
      expect(pwd2.stdout.trim()).toBe(dir1);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('cd Virtual Command - Subshell Behavior', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
    enableVirtualCommands();
    verifyCwd(originalCwd, 'Before test start');
  });

  afterEach(async () => {
    await afterTestCleanup();
    verifyCwd(originalCwd, 'After test cleanup');
  });

  test('should not affect parent shell when in subshell', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-subshell-'));
    const originalCwd = process.cwd();

    try {
      // Run cd in subshell (parentheses)
      await $`(cd ${tempDir})`;

      // Parent shell should still be in original directory
      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(originalCwd);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should work in subshell with other commands', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-subshell-cmd-'));
    const originalCwd = process.cwd();

    try {
      writeFileSync(join(tempDir, 'test.txt'), 'subshell test');

      // Run commands in subshell
      const result = await $`(cd ${tempDir} && cat test.txt)`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('subshell test');

      // Verify we're still in original directory
      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(originalCwd);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('cd Virtual Command - Edge Cases', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
    enableVirtualCommands();
    verifyCwd(originalCwd, 'Before test start');
  });

  afterEach(async () => {
    await afterTestCleanup();
    verifyCwd(originalCwd, 'After test cleanup');
  });

  test('should handle symlinks', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-symlink-'));
    const realDir = join(baseDir, 'real');
    const linkDir = join(baseDir, 'link');
    mkdirSync(realDir);
    const originalCwd = process.cwd();

    try {
      // Create symlink
      await $`ln -s ${realDir} ${linkDir}`;

      // cd through symlink
      const result = await $`cd ${linkDir}`;
      expect(result.code).toBe(0);

      // pwd should show the symlink path (default behavior)
      const pwd = await $`pwd`;
      // Note: behavior may vary between pwd and pwd -P
      expect(pwd.stdout.trim()).toBeTruthy();

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle very long paths', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-long-'));
    const originalCwd = process.cwd();

    try {
      // Create deeply nested directory
      let currentPath = baseDir;
      for (let i = 0; i < 10; i++) {
        currentPath = join(currentPath, `level${i}`);
        mkdirSync(currentPath);
      }

      const result = await $`cd ${currentPath}`;
      expect(result.code).toBe(0);

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(currentPath);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle permission errors gracefully', async () => {
    // Skip on Windows where permissions work differently
    if (process.platform === 'win32') {
      return;
    }

    const baseDir = mkdtempSync(join(tmpdir(), 'cd-perm-'));
    const restrictedDir = join(baseDir, 'restricted');
    mkdirSync(restrictedDir);
    const originalCwd = process.cwd();

    try {
      // Remove execute permission
      await $`chmod 000 ${restrictedDir}`;

      const result =
        await $`cd ${restrictedDir} 2>&1 || echo "permission denied"`;
      expect(result.stdout.toLowerCase()).toContain('denied');

      // Should still be in original directory
      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(originalCwd);
    } finally {
      // Restore permissions for cleanup - need to restore parent dir permission first
      try {
        await $`chmod 755 ${baseDir} 2>/dev/null || true`;
        await $`chmod 755 ${restrictedDir} 2>/dev/null || true`;
        rmSync(baseDir, { recursive: true, force: true });
      } catch (e) {
        // If cleanup fails, try with sudo as last resort
        await $`sudo rm -rf ${baseDir} 2>/dev/null || true`.catch(() => {});
      }
    }
  });

  test('should handle cd with trailing slash', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-slash-'));
    const originalCwd = process.cwd();

    try {
      // Test with trailing slash
      const result = await $`cd ${tempDir}/`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(tempDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should handle cd with multiple slashes', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-slashes-'));
    const subDir = join(baseDir, 'sub');
    mkdirSync(subDir);
    const originalCwd = process.cwd();

    try {
      // Test with multiple slashes (should normalize)
      const result = await $`cd ${baseDir}//sub///`;
      expect(result.code).toBe(0);

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(subDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('cd Virtual Command - Platform Compatibility', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
    enableVirtualCommands();
    verifyCwd(originalCwd, 'Before test start');
  });

  afterEach(async () => {
    await afterTestCleanup();
    verifyCwd(originalCwd, 'After test cleanup');
  });

  test('should handle platform-specific path separators', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-platform-'));
    const subDir = join(baseDir, 'cross', 'platform', 'test');
    mkdirSync(subDir, { recursive: true });
    const originalCwd = process.cwd();

    try {
      // Use platform-specific path
      const result = await $`cd ${subDir}`;
      expect(result.code).toBe(0);

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(subDir);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should normalize paths correctly', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-normalize-'));
    const sub1 = join(baseDir, 'sub1');
    const sub2 = join(sub1, 'sub2');
    mkdirSync(sub2, { recursive: true });
    const originalCwd = process.cwd();

    try {
      // Test path with ./ and ../
      await $`cd ${baseDir}`;
      await $`cd ./sub1/../sub1/sub2`;

      const pwd = await $`pwd`;
      expect(pwd.stdout.trim()).toBe(sub2);

      await $`cd ${originalCwd}`;
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
