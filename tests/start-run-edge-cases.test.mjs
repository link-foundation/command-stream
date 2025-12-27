#!/usr/bin/env node

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell } from '../src/$.mjs';

describe('Start/Run Edge Cases and Advanced Usage', () => {
  beforeEach(() => {
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
  });

  afterEach(() => {
    shell.errexit(false);
    shell.verbose(false);
    shell.xtrace(false);
    shell.pipefail(false);
    shell.nounset(false);
  });
  test('should handle complex option combinations', async () => {
    const result = await $`echo "complex test"`.start({
      capture: true,
      mirror: false,
      stdin: 'inherit',
      mode: 'async',
    });

    expect(result.stdout).toBe('complex test\n');
    expect(result.code).toBe(0);
  });

  test('should work with real shell commands that produce large output', async () => {
    const result = await $`ls -la /tmp`.start({ capture: false });

    expect(result.stdout).toBeUndefined();
    expect(result.code).toBe(0);
  });

  test('should handle stderr with capture: false', async () => {
    const result = await $`ls /nonexistent-path-12345`.start({
      capture: false,
    });

    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBeUndefined();
    expect(result.code).not.toBe(0); // ls should fail
  });

  test('should handle stderr with capture: true', async () => {
    const result = await $`ls /nonexistent-path-98765`.start({ capture: true });

    expect(result.stdout).toBe(''); // No stdout for failed ls
    expect(typeof result.stderr).toBe('string');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.code).not.toBe(0);
  });

  test('should handle multiple consecutive start() calls correctly', async () => {
    const runner = $`echo "multiple calls"`;

    // First call should work
    const result1 = await runner.start({ capture: true });
    expect(result1.stdout).toBe('multiple calls\n');

    // Second call should return the same result (cached)
    const result2 = await runner.start({ capture: false }); // Options ignored
    expect(result2.stdout).toBe('multiple calls\n'); // Still captured

    // Results should be the same object reference
    expect(result1).toBe(result2);
  });

  test('should handle mixed sync/async mode correctly', async () => {
    const result1 = await $`echo "async mode"`.start({ mode: 'async' });
    const result2 = $`echo "sync mode"`.start({ mode: 'sync' });

    expect(result1.stdout).toBe('async mode\n');
    expect(result2.stdout).toBe('sync mode\n');
  });

  test('should preserve original behavior when no options passed', async () => {
    const withStart = await $`echo "with start"`.start();
    const withRun = await $`echo "with run"`.run();
    const directAwait = await $`echo "direct await"`;

    expect(withStart.stdout).toBe('with start\n');
    expect(withRun.stdout).toBe('with run\n');
    expect(directAwait.stdout).toBe('direct await\n');

    // All should have same structure
    expect(Object.keys(withStart)).toEqual(Object.keys(withRun));
    expect(Object.keys(withRun)).toEqual(Object.keys(directAwait));
  });

  test('should work with piped commands', async () => {
    const result = await $`echo "hello world"`
      .pipe($`cat`)
      .start({ mirror: false });

    expect(result.stdout).toBe('hello world\n');
    expect(result.code).toBe(0);
  });

  test('should handle buffer stdin correctly with options', async () => {
    const inputBuffer = Buffer.from('buffer test data');
    const result = await $`cat`.start({
      stdin: inputBuffer,
      capture: true,
      mirror: false,
    });

    // Result might be a buffer or string depending on the command
    const output =
      typeof result.stdout === 'string'
        ? result.stdout
        : result.stdout?.toString();
    expect(output).toBe('buffer test data');
    expect(result.code).toBe(0);
  });

  test('should maintain performance with capture: false', async () => {
    // This test verifies that when capture is false, we don't waste memory
    const startTime = Date.now();

    const result = await $`echo "performance test"`.start({ capture: false });

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result.stdout).toBeUndefined();
    expect(result.code).toBe(0);
    expect(duration).toBeLessThan(1000); // Should complete quickly
  });

  test('should handle empty string stdin', async () => {
    const result = await $`cat`.start({
      stdin: '',
      capture: true,
      mirror: false,
    });

    expect(result.stdout).toBe('');
    expect(result.code).toBe(0);
  });
});
