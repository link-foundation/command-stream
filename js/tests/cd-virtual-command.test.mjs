import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  beforeTestCleanup,
  afterTestCleanup,
  originalCwd,
} from './test-cleanup.mjs';
import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from 'fs';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';

// Platform detection - Some tests use Unix-specific commands (cat, ln -s, chmod)
const isWindows = process.platform === 'win32';

// Helper to normalize paths (handles macOS /var -> /private/var symlink)
const normalizePath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// Helper function to verify we're in the expected directory
function verifyCwd(expected, message) {
  const actual = normalizePath(process.cwd());
  const expectedNormalized = normalizePath(expected);
  if (actual !== expectedNormalized) {
    throw new Error(
      `${message}: Expected cwd to be ${expectedNormalized}, but got ${actual}`
    );
  }
}

// Skip on Windows - uses pwd, cat, ln -s, chmod commands
describe.skipIf(isWindows)('cd Virtual Command - Core Behavior', () => {
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

    try {
      // Verify we start in the original directory
      verifyCwd(originalCwd, 'Test start');

      const result = await $`cd ${tempDir} && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(tempDir));
      expect(result.stderr).toBe('');
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should change to relative path', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-base-'));
    const subDir = join(baseDir, 'subdir');
    mkdirSync(subDir);
    try {
      const result = await $`cd ${baseDir} && cd subdir && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(subDir));
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle cd with no arguments (go to home)', async () => {
    const result = await $`cd && pwd`;
    expect(result.code).toBe(0);
    const home = homedir();
    expect(result.stdout.trim()).toBe(home);
    verifyCwd(originalCwd, 'After invocation');
  });

  test('should handle cd - (return to previous directory)', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'cd-dir1-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'cd-dir2-'));

    try {
      // `cd -` switches back to the previous directory and prints it,
      // exactly like POSIX sh/bash.
      const result = await $`cd ${dir1} && cd ${dir2} && cd - && pwd`;
      expect(result.code).toBe(0);
      const outputLines = result.stdout.trim().split('\n').map(normalizePath);
      expect(outputLines).toEqual([normalizePath(dir1), normalizePath(dir1)]);
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('should handle cd .. (parent directory)', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-parent-'));
    const subDir = join(baseDir, 'child');
    mkdirSync(subDir);
    try {
      const result = await $`cd ${subDir} && cd .. && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(baseDir));
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle cd . (current directory)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-dot-'));
    try {
      const result = await $`cd ${tempDir} && pwd && cd . && pwd`;
      expect(result.code).toBe(0);
      const outputLines = result.stdout.trim().split('\n').map(normalizePath);
      expect(outputLines).toEqual([
        normalizePath(tempDir),
        normalizePath(tempDir),
      ]);
      verifyCwd(originalCwd, 'After invocation');
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
    try {
      const result = await $`cd ${dirWithSpaces} && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(
        normalizePath(dirWithSpaces)
      );
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle special characters in paths', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-special-'));
    // Create directory with special characters (but valid for filesystem)
    const specialDir = join(baseDir, 'test-dir_123');
    mkdirSync(specialDir);
    try {
      const result = await $`cd ${specialDir} && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(
        normalizePath(specialDir)
      );
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// Skip on Windows - uses pwd and cat commands
describe.skipIf(isWindows)('cd Virtual Command - Command Chains', () => {
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

    try {
      // Create a test file in temp directory
      writeFileSync(join(tempDir, 'test.txt'), 'test content');

      // cd and run command in same chain
      const result = await $`cd ${tempDir} && cat test.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('test content');
      verifyCwd(originalCwd, 'After invocation');
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
    try {
      writeFileSync(join(dir1, 'file1.txt'), 'content1');
      writeFileSync(join(dir2, 'file2.txt'), 'content2');

      // Chain multiple cd commands
      const result =
        await $`cd ${dir1} && cat file1.txt && cd ${dir2} && cat file2.txt`;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('content1');
      expect(result.stdout).toContain('content2');
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should work with git commands in chain', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cd-git-'));

    try {
      const result = await $`cd ${tempDir} && git init`;
      expect(result.code).toBe(0);
      // Git init outputs to stderr
      const output = (result.stdout + result.stderr).toLowerCase();
      expect(output).toContain('initialized');

      // Verify git repo was created in the right place
      expect(existsSync(join(tempDir, '.git'))).toBe(true);
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should isolate directory context between separate invocations', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'cd-ctx1-'));
    const originalCwd = process.cwd();

    try {
      // A standalone cd succeeds but does not change its caller's directory.
      await $`cd ${dir1}`;
      const pwd1 = await $`pwd`;
      expect(normalizePath(pwd1.stdout.trim())).toBe(
        normalizePath(originalCwd)
      );
      verifyCwd(originalCwd, 'After separate invocations');
    } finally {
      rmSync(dir1, { recursive: true, force: true });
    }
  });
});

// Skip on Windows - uses subshells (parentheses) and pwd/cat commands
describe.skipIf(isWindows)('cd Virtual Command - Subshell Behavior', () => {
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

// Skip on Windows - uses ln -s, chmod, and pwd commands
describe.skipIf(isWindows)('cd Virtual Command - Edge Cases', () => {
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
    try {
      // Create symlink
      await $`ln -s ${realDir} ${linkDir}`;

      // cd through symlink
      const result = await $`cd ${linkDir} && pwd`;
      expect(result.code).toBe(0);

      // The OS may resolve the symlink, so compare canonical paths.
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(realDir));
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test('should handle very long paths', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-long-'));

    try {
      // Create deeply nested directory
      let currentPath = baseDir;
      for (let i = 0; i < 10; i++) {
        currentPath = join(currentPath, `level${i}`);
        mkdirSync(currentPath);
      }

      const result = await $`cd ${currentPath} && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(
        normalizePath(currentPath)
      );
      verifyCwd(originalCwd, 'After invocation');
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

    try {
      // Test with trailing slash
      const result = await $`cd ${tempDir}/ && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(tempDir));
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should handle cd with multiple slashes', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cd-slashes-'));
    const subDir = join(baseDir, 'sub');
    mkdirSync(subDir);
    try {
      // Test with multiple slashes (should normalize)
      const result = await $`cd ${baseDir}//sub/// && pwd`;
      expect(result.code).toBe(0);
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(subDir));
      verifyCwd(originalCwd, 'After invocation');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// Skip on Windows - uses pwd command
describe.skipIf(isWindows)(
  'cd Virtual Command - Platform Compatibility',
  () => {
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
      try {
        // Use platform-specific path
        const result = await $`cd ${subDir} && pwd`;
        expect(result.code).toBe(0);
        expect(normalizePath(result.stdout.trim())).toBe(normalizePath(subDir));
        verifyCwd(originalCwd, 'After invocation');
      } finally {
        rmSync(baseDir, { recursive: true, force: true });
      }
    });

    test('should normalize paths correctly', async () => {
      const baseDir = mkdtempSync(join(tmpdir(), 'cd-normalize-'));
      const sub1 = join(baseDir, 'sub1');
      const sub2 = join(sub1, 'sub2');
      mkdirSync(sub2, { recursive: true });
      try {
        // Test path with ./ and ../
        const result = await $`cd ${baseDir} && cd ./sub1/../sub1/sub2 && pwd`;
        expect(normalizePath(result.stdout.trim())).toBe(normalizePath(sub2));
        verifyCwd(originalCwd, 'After invocation');
      } finally {
        rmSync(baseDir, { recursive: true, force: true });
      }
    });
  }
);
