#!/usr/bin/env node

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  beforeTestCleanup,
  afterTestCleanup,
  originalCwd,
} from './test-cleanup.mjs';
import { isWindows } from './test-helper.mjs';
import { $ } from '../js/src/$.mjs';
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

  test('should restore cwd after simple cd command', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
    testDirs.push(tempDir);

    // Change directory
    await $`cd ${tempDir}`;

    // Verify we changed
    const result = await $`pwd`;
    expect(normalizePath(result.stdout.trim())).toBe(normalizePath(tempDir));

    // Cwd should be changed within test
    expect(normalizePath(process.cwd())).toBe(normalizePath(tempDir));
  });

  test('should be back in original directory after cd test', () => {
    // This test verifies the previous test's cleanup worked
    const currentCwd = process.cwd();
    expect(currentCwd).toBe(originalCwd);
  });

  test('should restore cwd after cd with && operator', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cleanup-test2-'));
    testDirs.push(tempDir);

    // Change directory with && operator
    await $`cd ${tempDir} && echo "test"`;

    // Should be in temp dir
    expect(normalizePath(process.cwd())).toBe(normalizePath(tempDir));
  });

  test('should verify restoration after && cd test', () => {
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

  test('should restore cwd after multiple cd commands', async () => {
    const tempDir1 = mkdtempSync(join(tmpdir(), 'cleanup-test4-'));
    const tempDir2 = mkdtempSync(join(tmpdir(), 'cleanup-test5-'));
    testDirs.push(tempDir1, tempDir2);

    // Multiple cd commands
    await $`cd ${tempDir1}`;
    expect(normalizePath(process.cwd())).toBe(normalizePath(tempDir1));

    await $`cd ${tempDir2}`;
    expect(normalizePath(process.cwd())).toBe(normalizePath(tempDir2));

    await $`cd ${tempDir1}`;
    expect(normalizePath(process.cwd())).toBe(normalizePath(tempDir1));
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
