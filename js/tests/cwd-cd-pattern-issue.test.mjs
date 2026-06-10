import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  beforeTestCleanup,
  afterTestCleanup,
  originalCwd,
} from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';
import { isWindows } from './test-helper.mjs';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Normalize paths to handle macOS /var -> /private/var symlink resolution so
// comparisons against process.cwd() are stable across platforms.
const normalizePath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// These scenarios rely on POSIX shell semantics (pwd, ls, cat, mkdir -p,
// `&&` chaining, git status format), which the cmd.exe-backed Windows runner
// does not provide. Skip on Windows like the repo's other Unix-shell suites.
describe.skipIf(isWindows)('Issue #50: CWD with CD pattern failure', () => {
  let testDir;

  beforeEach(async () => {
    await beforeTestCleanup();
    // Normalize so comparisons against process.cwd()/pwd are stable on macOS,
    // where the temp dir lives under /var but resolves to /private/var.
    testDir = normalizePath(mkdtempSync(join(tmpdir(), 'issue-50-')));
  });

  afterEach(async () => {
    // Ensure we're back in original directory
    process.chdir(originalCwd);
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
    await afterTestCleanup();
  });

  test('should handle separate cd and pwd commands correctly', async () => {
    // Start from original directory
    process.chdir(originalCwd);

    // Run cd command
    const cdResult = await $`cd ${testDir}`;
    expect(cdResult.code).toBe(0);

    // Check that Node.js CWD actually changed
    expect(process.cwd()).toBe(testDir);

    // Run pwd command
    const pwdResult = await $`pwd`;
    expect(pwdResult.code).toBe(0);
    expect(pwdResult.stdout.trim()).toBe(testDir);
  });

  test('should handle cd && pwd pattern correctly', async () => {
    process.chdir(originalCwd);

    const result = await $`cd ${testDir} && pwd`;
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(testDir);

    // Node.js CWD should also be changed by the virtual cd
    expect(process.cwd()).toBe(testDir);
  });

  test('should handle git scenario from issue description', async () => {
    const testFile = join(testDir, 'test.txt');
    writeFileSync(testFile, 'Test content');

    // Initialize git repo
    await $({ cwd: testDir })`git init`;

    // Start from original directory
    process.chdir(originalCwd);

    // This pattern was failing according to the issue
    const addResult = await $`cd ${testDir} && git add test.txt`;
    expect(addResult.code).toBe(0);

    // Check git status to verify file was actually added
    const statusResult = await $({ cwd: testDir })`git status --short`;
    const status = statusResult.stdout.toString().trim();

    // File should be staged (A  test.txt) not untracked (?? test.txt)
    expect(status).toContain('A  test.txt');
    expect(status).not.toContain('??');
  });

  test('should maintain directory changes across multiple shell operations', async () => {
    const subDir = join(testDir, 'subdir');
    const subSubDir = join(subDir, 'subsubdir');

    // Create nested directories
    await $({ cwd: testDir })`mkdir -p subdir/subsubdir`;

    process.chdir(originalCwd);

    // Chain multiple cd operations
    const result = await $`cd ${testDir} && cd subdir && cd subsubdir && pwd`;
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(subSubDir);

    // Check that Node.js CWD reflects the final directory
    expect(process.cwd()).toBe(subSubDir);
  });

  test('should handle complex build scenario with cd pattern', async () => {
    const srcDir = join(testDir, 'src');
    const buildFile = join(srcDir, 'index.js');

    // Create source directory and file
    await $({ cwd: testDir })`mkdir src`;
    writeFileSync(buildFile, 'console.log("Hello from build");');

    process.chdir(originalCwd);

    // Simulate build process that depends on being in correct directory
    const buildResult = await $`cd ${testDir} && ls src && cat src/index.js`;
    expect(buildResult.code).toBe(0);
    expect(buildResult.stdout).toContain('index.js');
    expect(buildResult.stdout).toContain('Hello from build');
  });

  test('should work with relative paths after cd', async () => {
    const subDir = join(testDir, 'relative-test');
    await $({ cwd: testDir })`mkdir relative-test`;

    process.chdir(originalCwd);

    // Use cd then relative paths
    const result = await $`cd ${testDir} && cd relative-test && pwd`;
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(subDir);
  });

  test('should handle cwd option vs cd command consistency', async () => {
    const testFile = join(testDir, 'consistency.txt');
    writeFileSync(testFile, 'test content');

    process.chdir(originalCwd);

    // Method 1: Using cd command
    const cdMethod = await $`cd ${testDir} && cat consistency.txt`;

    // Reset directory
    process.chdir(originalCwd);

    // Method 2: Using cwd option
    const cwdMethod = await $({ cwd: testDir })`cat consistency.txt`;

    // Both methods should produce the same result
    expect(cdMethod.code).toBe(0);
    expect(cwdMethod.code).toBe(0);
    expect(cdMethod.stdout).toBe(cwdMethod.stdout);
    expect(cdMethod.stdout.trim()).toBe('test content');
  });

  test('should handle error cases correctly', async () => {
    const nonExistentDir = join(testDir, 'does-not-exist');

    process.chdir(originalCwd);

    // cd to non-existent directory should fail
    const result = await $`cd ${nonExistentDir} && pwd`;
    expect(result.code).not.toBe(0);

    // Should remain in original directory
    expect(process.cwd()).toBe(originalCwd);
  });
});

// sh-translation semantics ($HOME, ~ expansion, cd -, $PWD/$OLDPWD) are POSIX
// shell concepts; skip on the cmd.exe-backed Windows runner.
describe.skipIf(isWindows)(
  'Issue #50: cd sh-compatibility (drop-in translation from sh)',
  () => {
    let testDir;

    beforeEach(async () => {
      await beforeTestCleanup();
      testDir = normalizePath(
        mkdtempSync(join(tmpdir(), 'issue-50-shcompat-'))
      );
    });

    afterEach(async () => {
      process.chdir(originalCwd);
      if (testDir) {
        rmSync(testDir, { recursive: true, force: true });
      }
      await afterTestCleanup();
    });

    test('cd with no argument goes to $HOME (like sh)', async () => {
      process.chdir(testDir);
      const result = await $`cd`;
      expect(result.code).toBe(0);
      expect(normalizePath(process.cwd())).toBe(
        normalizePath(process.env.HOME)
      );
    });

    test('cd ~ expands tilde to $HOME (like sh)', async () => {
      process.chdir(testDir);
      const result = await $`cd ~`;
      expect(result.code).toBe(0);
      expect(normalizePath(process.cwd())).toBe(
        normalizePath(process.env.HOME)
      );
    });

    test('cd ~/subpath expands tilde prefix (like sh)', async () => {
      process.chdir(testDir);
      const result = await $`cd ~/`;
      expect(result.code).toBe(0);
      expect(normalizePath(process.cwd())).toBe(
        normalizePath(process.env.HOME)
      );
    });

    test('cd - switches to previous directory and prints it (like sh)', async () => {
      const dirA = normalizePath(mkdtempSync(join(tmpdir(), 'issue-50-a-')));
      const dirB = normalizePath(mkdtempSync(join(tmpdir(), 'issue-50-b-')));
      try {
        await $`cd ${dirA}`;
        await $`cd ${dirB}`;
        const result = await $`cd -`;
        expect(result.code).toBe(0);
        // sh prints the new (previous) directory on `cd -`
        expect(normalizePath(result.stdout.trim())).toBe(dirA);
        expect(normalizePath(process.cwd())).toBe(dirA);
      } finally {
        process.chdir(originalCwd);
        rmSync(dirA, { recursive: true, force: true });
        rmSync(dirB, { recursive: true, force: true });
      }
    });

    test('cd updates PWD and OLDPWD environment variables (like sh)', async () => {
      const start = normalizePath(mkdtempSync(join(tmpdir(), 'issue-50-pwd-')));
      try {
        await $`cd ${start}`;
        expect(normalizePath(process.env.PWD)).toBe(start);
        await $`cd ${testDir}`;
        expect(normalizePath(process.env.PWD)).toBe(testDir);
        expect(normalizePath(process.env.OLDPWD)).toBe(start);
      } finally {
        process.chdir(originalCwd);
        rmSync(start, { recursive: true, force: true });
      }
    });

    test('cd to a non-existent directory reports a sh-style error and keeps cwd', async () => {
      process.chdir(testDir);
      const result = await $`cd ${join(testDir, 'nope')}`;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('cd:');
      expect(normalizePath(process.cwd())).toBe(testDir);
    });

    test('relative cd resolves against the cwd option', async () => {
      const subDir = join(testDir, 'sub');
      await $({ cwd: testDir })`mkdir sub`;
      process.chdir(originalCwd);
      const result = await $({ cwd: testDir })`cd sub`;
      expect(result.code).toBe(0);
      expect(normalizePath(process.cwd())).toBe(normalizePath(subDir));
    });
  }
);
