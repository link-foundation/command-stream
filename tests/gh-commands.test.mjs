import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';

describe('GitHub CLI (gh) commands', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
  });
  
  afterEach(async () => {
    await afterTestCleanup();
  });
  test('gh auth status returns correct exit code and output structure', async () => {
    // Test with capture to check output
    const result = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    
    // Should have an exit code property
    expect(result.code).toBeDefined();
    expect(typeof result.code).toBe('number');
    
    // Exit code should be 0 if authenticated, 1 if not
    expect([0, 1]).toContain(result.code);
    
    // Should have stdout
    expect(result.stdout).toBeDefined();
    expect(typeof result.stdout).toBe('string');
    
    // If authenticated (exit code 0), output should contain success indicators
    if (result.code === 0) {
      const output = result.stdout;
      const isAuthenticated = output.includes('Logged in to') || output.includes('✓');
      expect(isAuthenticated).toBe(true);
    }
  });
  
  test('gh command with invalid subcommand returns non-zero exit code', async () => {
    try {
      const result = await $`gh invalid-command 2>&1`.run({ capture: true, mirror: false });
      // If it doesn't throw, check the exit code
      expect(result.code).toBeGreaterThan(0);
    } catch (error) {
      // Some configurations might throw on non-zero exit
      expect(error.code).toBeGreaterThan(0);
    }
  });
  
  test('gh api can be called with parameters', async () => {
    // Skip if GITHUB_TOKEN is not set or not authenticated
    if (!process.env.GITHUB_TOKEN) {
      console.log('Skipping gh api test - GITHUB_TOKEN not set');
      return;
    }
    
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping gh api test - not authenticated');
      return;
    }
    
    // Test basic API call
    const result = await $`gh api user --jq .login`.run({ capture: true, mirror: false });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
  
  test('gh gist list works with parameters', async () => {
    // Skip if GITHUB_TOKEN is not set or not authenticated
    if (!process.env.GITHUB_TOKEN) {
      console.log('Skipping gh gist test - GITHUB_TOKEN not set');
      return;
    }
    
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping gh gist test - not authenticated');
      return;
    }
    
    // Test gist list with limit
    const result = await $`gh gist list --limit 1`.run({ capture: true, mirror: false });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    // Output could be empty if user has no gists
    expect(typeof result.stdout).toBe('string');
  });
  
  test('complex gh command with pipes and jq', async () => {
    // Skip if GITHUB_TOKEN is not set or not authenticated
    if (!process.env.GITHUB_TOKEN) {
      console.log('Skipping complex gh test - GITHUB_TOKEN not set');
      return;
    }
    
    const authCheck = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    if (authCheck.code !== 0) {
      console.log('Skipping complex gh test - not authenticated');
      return;
    }
    
    // Test complex command with pipe
    const result = await $`gh api user --jq .login | head -1`.run({ capture: true, mirror: false });
    
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout.split('\n').length).toBeLessThanOrEqual(2); // Should be one line plus possible newline
  });
});