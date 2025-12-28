/**
 * Tests for Bun runtime shell path issue fix
 *
 * This addresses GitHub issue #42: Bun runtime shell path issues
 * The issue was that string interpolation in template literals was incorrectly quoting
 * complete command strings, causing shell commands to fail execution.
 */

import { test, expect, describe } from 'bun:test';
import { $ } from '../src/$.mjs';

// Test both Bun and Node.js runtimes
const isBun = typeof globalThis.Bun !== 'undefined';
const runtime = isBun ? 'Bun' : 'Node.js';

// Platform detection - Some tests use Unix-specific paths and commands
const isWindows = process.platform === 'win32';

// Skip on Windows - tests reference /bin/sh and Unix paths
describe.skipIf(isWindows)(`String interpolation fix for ${runtime}`, () => {
  test('Template literal without interpolation should work', async () => {
    const result = await $`echo hello`;
    expect(result.stdout.toString().trim()).toBe('hello');
  });

  test('String interpolation with complete command should work', async () => {
    const cmd = 'echo hello';
    const result = await $`${cmd}`;
    expect(result.stdout.toString().trim()).toBe('hello');
  });

  test('String interpolation with command and args should work', async () => {
    const cmd = 'echo "hello world"';
    const result = await $`${cmd}`;
    expect(result.stdout.toString().trim()).toBe('hello world');
  });

  test('Mixed template literal with interpolation should work', async () => {
    const arg = 'hello';
    const result = await $`echo ${arg}`;
    expect(result.stdout.toString().trim()).toBe('hello');
  });

  test('Complex shell commands via interpolation should work', async () => {
    const cmd = 'echo hello | wc -w';
    const result = await $`${cmd}`;
    expect(result.stdout.toString().trim()).toBe('1');
  });

  test('Shell operators in interpolated commands should work', async () => {
    const cmd = 'test -f /bin/sh && echo "sh exists"';
    const result = await $`${cmd}`;
    expect(result.stdout.toString().trim()).toBe('sh exists');
  });

  test('Commands with special characters should work', async () => {
    const cmd = 'echo "test $HOME" | head -1';
    const result = await $`${cmd}`;
    expect(result.stdout.toString()).toContain('test ');
  });

  test('Multiple argument interpolation should still quote properly', async () => {
    const arg1 = 'hello';
    const arg2 = 'world with spaces';
    const result = await $`echo ${arg1} ${arg2}`;
    expect(result.stdout.toString().trim()).toBe('hello world with spaces');
  });

  test('Empty command string should not cause issues', async () => {
    const cmd = '';
    // This should not fail catastrophically
    try {
      await $`${cmd}`;
    } catch (error) {
      // It's expected to fail, but not with our quoting issue
      expect(error.message).not.toContain('not found');
    }
  });

  test('Command with unsafe characters should be handled correctly', async () => {
    // This tests that we don't break security when fixing the quoting issue
    const unsafeCmd = 'echo "safe"; echo "also safe"';
    const result = await $`${unsafeCmd}`;
    const lines = result.stdout.toString().trim().split('\n');
    expect(lines).toContain('safe');
    expect(lines).toContain('also safe');
  });
});

// Additional runtime-specific tests
// Skip on Windows - uses 'pwd' which outputs Unix-style paths with '/'
if (isBun) {
  describe.skipIf(isWindows)('Bun-specific shell path tests', () => {
    test('Bun.spawn compatibility is maintained', async () => {
      const result = await $`pwd`;
      expect(result.stdout.toString().trim()).toContain('/');
    });

    test('Bun runtime detection works correctly', async () => {
      // This is more of a meta-test to ensure our runtime detection is correct
      expect(typeof globalThis.Bun).toBe('object');
    });
  });
} else {
  describe.skipIf(isWindows)('Node.js-specific shell path tests', () => {
    test('Node.js child_process compatibility is maintained', async () => {
      const result = await $`pwd`;
      expect(result.stdout.toString().trim()).toContain('/');
    });

    test('Node.js runtime detection works correctly', async () => {
      expect(typeof process.version).toBe('string');
    });
  });
}
