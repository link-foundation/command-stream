#!/usr/bin/env node

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  beforeTestCleanup,
  afterTestCleanup,
  originalCwd,
} from './test-cleanup.mjs';
import { isWindows } from './test-helper.mjs';
import { $ } from '../src/$.mjs';
import { mkdtempSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Helper to normalize paths (handles macOS /var -> /private/var symlink)
const normalizePath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

describe('Cleanup Verification', () => {
  beforeEach(beforeTestCleanup);
  afterEach(afterTestCleanup);

  let testDirs = [];

  afterEach(() => {
    // Clean up test directories
    for (const dir of testDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    testDirs = [];
  });

  test('should start in original directory', () => {
    const currentCwd = process.cwd();
    expect(currentCwd).toBe(originalCwd);
  });

  test('should preserve host cwd after simple cd command', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
    testDirs.push(tempDir);

    // The command sees the changed directory within its invocation.
    const result = await $`cd ${tempDir} && pwd`;
    expect(normalizePath(result.stdout.trim())).toBe(normalizePath(tempDir));

    // The invocation-local change never reaches the host process.
    expect(process.cwd()).toBe(originalCwd);
  });

  test('should be back in original directory after cd test', () => {
    // This test verifies the previous test's cleanup worked
    const currentCwd = process.cwd();
    expect(currentCwd).toBe(originalCwd);
  });

  test('should preserve host cwd after cd with && operator', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test2-'));
    testDirs.push(tempDir);

    const result = await $`cd ${tempDir} && echo "test" && pwd`;

    expect(result.stdout).toContain('test');
    expect(normalizePath(result.stdout.trim().split('\n').at(-1))).toBe(
      normalizePath(tempDir)
    );
    expect(process.cwd()).toBe(originalCwd);
  });

  test('should verify host cwd after && cd test', () => {
    const currentCwd = process.cwd();
    expect(currentCwd).toBe(originalCwd);
  });

  // Skip on Windows - uses subshell syntax and pwd command
  test.skipIf(isWindows)(
    'should not affect cwd when cd is in subshell',
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test3-'));
      testDirs.push(tempDir);

      // Change directory in subshell - should not affect parent
      const result = await $`(cd ${tempDir} && pwd)`;
      expect(normalizePath(result.stdout.trim())).toBe(normalizePath(tempDir));

      // Should still be in original directory
      const currentCwd = process.cwd();
      expect(currentCwd).toBe(originalCwd);
    }
  );

  test('should preserve host cwd after multiple cd commands', async () => {
    const tempDir1 = mkdtempSync(join(tmpdir(), 'cleanup-test4-'));
    const tempDir2 = mkdtempSync(join(tmpdir(), 'cleanup-test5-'));
    testDirs.push(tempDir1, tempDir2);

    // Each standalone cd is isolated from the next invocation.
    await $`cd ${tempDir1}`;
    expect(process.cwd()).toBe(originalCwd);

    await $`cd ${tempDir2}`;
    expect(process.cwd()).toBe(originalCwd);

    await $`cd ${tempDir1}`;
    expect(process.cwd()).toBe(originalCwd);
  });

  test('final verification - should still be in original directory', () => {
    // Final check that all previous tests were properly cleaned up
    const currentCwd = process.cwd();
    expect(currentCwd).toBe(originalCwd);

    // Also verify with pwd command
    return $`pwd`.then((result) => {
      expect(result.stdout.trim()).toBe(originalCwd);
    });
  });
});
