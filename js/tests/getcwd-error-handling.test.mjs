import { expect, test, describe, afterEach } from 'bun:test';
import { $ } from '../src/$.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Regression tests for issue #44: "getcwd() failed" error.
//
// process.cwd() throws "getcwd() failed: No such file or directory" when the
// current working directory has been deleted or becomes inaccessible (common in
// CI/CD with temporary directories). Subshell execution and directory
// restoration must degrade gracefully instead of crashing.

describe('getcwd() error handling', () => {
  const originalCwd = process.cwd;
  const startDir = process.cwd.call(process);

  afterEach(() => {
    // Always restore the real process.cwd and a valid working directory so a
    // failure in one test does not cascade into the others.
    process.cwd = originalCwd;
    try {
      process.chdir(startDir);
    } catch {
      // ignore
    }
  });

  test('subshell completes when process.cwd() always fails', async () => {
    // Simulate getcwd() failing the way it does on a deleted directory.
    process.cwd = function () {
      const error = new Error('getcwd() failed: No such file or directory');
      error.errno = -2;
      error.code = 'ENOENT';
      throw error;
    };

    const result = await $`(echo "test subshell")`;

    process.cwd = originalCwd;
    expect(result.stdout.toString().trim()).toBe('test subshell');
    expect(result.code).toBe(0);
  });

  test('subshell completes when process.cwd() fails only inside _runSubshell', async () => {
    process.cwd = function () {
      const stack = new Error().stack;
      if (stack.includes('_runSubshell')) {
        const error = new Error('getcwd() failed: No such file or directory');
        error.errno = -2;
        error.code = 'ENOENT';
        throw error;
      }
      return originalCwd.call(this);
    };

    const result = await $`(echo "still works")`;

    process.cwd = originalCwd;
    expect(result.stdout.toString().trim()).toBe('still works');
    expect(result.code).toBe(0);
  });

  test('multiple commands keep working after getcwd() failures', async () => {
    let failures = 0;
    process.cwd = function () {
      const stack = new Error().stack;
      if (stack.includes('_runSubshell') && failures < 2) {
        failures++;
        const error = new Error('getcwd() failed: No such file or directory');
        error.errno = -2;
        error.code = 'ENOENT';
        throw error;
      }
      return originalCwd.call(this);
    };

    const r1 = await $`(echo "first")`;
    const r2 = await $`(echo "second")`;
    const r3 = await $`(echo "third")`;

    process.cwd = originalCwd;
    expect(r1.stdout.toString().trim()).toBe('first');
    expect(r2.stdout.toString().trim()).toBe('second');
    expect(r3.stdout.toString().trim()).toBe('third');
  });

  test('subshell runs even when the real working directory was deleted', async () => {
    // Create a temporary directory, switch into it, then delete it so the
    // process is left with a working directory that no longer exists.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'getcwd-test-'));
    process.chdir(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });

    try {
      const result = await $`(echo "deleted dir")`;
      expect(result.stdout.toString().trim()).toBe('deleted dir');
      expect(result.code).toBe(0);
    } finally {
      // Restore a valid directory for subsequent tests.
      try {
        process.chdir(startDir);
      } catch {
        // ignore
      }
    }
  });
});
