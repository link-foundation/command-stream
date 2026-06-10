import { test, expect, describe, beforeEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell } from '../src/$.mjs';

describe('exitCode alias for code', () => {
  beforeEach(() => {
    // Reset all shell settings before each test
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
  });

  test('should provide exitCode as alias for code property', async () => {
    const result = await $`exit 0`;
    expect(result.code).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.code).toBe(result.exitCode);
  });

  test('should have matching exitCode for non-zero exit codes', async () => {
    const result = await $`exit 42`;
    expect(result.code).toBe(42);
    expect(result.exitCode).toBe(42);
    expect(result.code).toBe(result.exitCode);
  });

  test('should have matching exitCode for successful commands', async () => {
    const result = await $`echo "hello"`;
    expect(result.code).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.code).toBe(result.exitCode);
    expect(result.stdout.trim()).toBe('hello');
  });

  test('should maintain exitCode alias in pipeline operations', async () => {
    const result = await $`echo "test" | grep "test"`;
    expect(result.code).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.code).toBe(result.exitCode);
  });

  test('should maintain exitCode alias for failed commands', async () => {
    const result = await $`exit 42`;
    expect(result.code).toBe(42);
    expect(result.exitCode).toBe(42);
    expect(result.code).toBe(result.exitCode);
  });
});