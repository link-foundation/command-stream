#!/usr/bin/env node

import { test, expect, describe } from 'bun:test';
import { $ } from '../src/$.mjs';

describe('stderr redirection handling', () => {
  test('should capture stderr when using >&2 redirection', async () => {
    const result = await $`echo "error message" >&2`;
    
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('error message\n');
    expect(result.code).toBe(0);
  });

  test('should handle mixed stdout and stderr', async () => {
    const result = await $`echo "stdout message" && echo "stderr message" >&2`;
    
    expect(result.stdout).toBe('stdout message\n');
    expect(result.stderr).toBe('stderr message\n');
    expect(result.code).toBe(0);
  });

  test('should handle 2>&1 redirection correctly', async () => {
    const result = await $`sh -c "echo \\"stderr to stdout\\" >&2" 2>&1`;
    
    expect(result.stdout).toBe('stderr to stdout\n');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  test('should bypass virtual commands when stderr redirection is needed', async () => {
    // This test ensures that virtual echo command is bypassed when >&2 is used
    // and the real shell handles the redirection properly
    const result = await $`echo "virtual bypass test" >&2`;
    
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('virtual bypass test\n');
    expect(result.code).toBe(0);
  });

  test('should work with commands that actually output to stderr (simulating gh pr create)', async () => {
    // Simulate behavior similar to gh pr create which outputs URLs to stderr
    const result = await $`echo "https://github.com/test/repo/pull/123" >&2`;
    
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('https://github.com/test/repo/pull/123\n');
    expect(result.code).toBe(0);
    
    // Verify we can extract the URL from stderr
    const prUrl = result.stderr.trim();
    expect(prUrl).toMatch(/^https:\/\/github\.com\/.*\/pull\/\d+$/);
  });

  test('normal stdout should still work (regression test)', async () => {
    const result = await $`echo "normal output"`;
    
    expect(result.stdout).toBe('normal output\n');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });
});