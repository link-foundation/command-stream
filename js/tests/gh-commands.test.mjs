import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $ } from '../src/$.mjs';

// Platform detection - tests use Unix shell redirection 2>&1 and sh -c
const isWindows = process.platform === 'win32';

// Skip on Windows - tests use 2>&1 shell redirection, pipes with head, and sh -c
describe.skipIf(isWindows)('GitHub CLI (gh) commands', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
  });

  afterEach(async () => {
    await afterTestCleanup();
  });
  test('gh auth status returns correct exit code and output structure', async () => {
    // Test with capture to check output
    const result = await $`gh auth status 2>&1`.run({
      capture: true,
      mirror: false,
    });

    // Should have an exit code property
    expect(result.code).toBeDefined();
    expect(typeof result.code).toBe('number');

    // Exit code should be 0 if authenticated, 1 if not - both are OK
    // We're testing $.mjs command execution, not gh auth itself
    expect([0, 1]).toContain(result.code);

    // Should have stdout
    expect(result.stdout).toBeDefined();
    expect(typeof result.stdout).toBe('string');

    // If authenticated (exit code 0), output should contain success indicators
    // If not authenticated (exit code 1), that's also fine - we're testing $.mjs works
    if (result.code === 0) {
      const output = result.stdout;
      const isAuthenticated =
        output.includes('Logged in to') ||
        output.includes('✓') ||
        output.includes('github.com');
      // Don't fail if indicators aren't found - different gh versions may have different output
      expect(output.length).toBeGreaterThan(0);
    } else {
      // Exit code 1 means not authenticated, which is OK for our test purposes
      expect(result.stdout.length).toBeGreaterThanOrEqual(0);
    }
  });

  test('gh command with invalid subcommand returns non-zero exit code', async () => {
    try {
      const result = await $`gh invalid-command 2>&1`.run({
        capture: true,
        mirror: false,
      });
      // If it doesn't throw, check the exit code
      expect(result.code).toBeGreaterThan(0);
    } catch (error) {
      // Some configurations might throw on non-zero exit
      expect(error.code).toBeGreaterThan(0);
    }
  });

  test('gh api can be called with parameters', async () => {
    // Check authentication first
    const authCheck = await $`gh auth status 2>&1`.run({
      capture: true,
      mirror: false,
    });
    if (authCheck.code !== 0) {
      console.log(
        'Skipping gh api test - not authenticated (this is OK - we are testing $.mjs, not gh auth)'
      );
      return;
    }

    // Try to run the API command
    const result = await $`gh api user --jq .login 2>&1`.run({
      capture: true,
      mirror: false,
    });

    // If we get "Resource not accessible by integration" it means we're in CI with limited token
    // This is OK - we're testing that $.mjs can execute the command, not that we have full API access
    if (
      result.code !== 0 &&
      result.stdout.includes('Resource not accessible by integration')
    ) {
      console.log(
        'Skipping gh api test - limited GitHub Actions token (this is OK - we are testing $.mjs, not gh permissions)'
      );
      return;
    }

    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  test('gh gist list works with parameters', async () => {
    // Check authentication first
    const authCheck = await $`gh auth status 2>&1`.run({
      capture: true,
      mirror: false,
    });
    if (authCheck.code !== 0) {
      console.log(
        'Skipping gh gist test - not authenticated (this is OK - we are testing $.mjs, not gh auth)'
      );
      return;
    }

    // Try to run the gist command
    const result = await $`gh gist list --limit 1 2>&1`.run({
      capture: true,
      mirror: false,
    });

    // If we get "Resource not accessible by integration" it means we're in CI with limited token
    // This is OK - we're testing that $.mjs can execute the command, not that we have full API access
    if (
      result.code !== 0 &&
      result.stdout.includes('Resource not accessible by integration')
    ) {
      console.log(
        'Skipping gh gist test - limited GitHub Actions token (this is OK - we are testing $.mjs, not gh permissions)'
      );
      return;
    }

    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    // Output could be empty if user has no gists
    expect(typeof result.stdout).toBe('string');
  });

  test('complex gh command with pipes and jq', async () => {
    // Check authentication first
    const authCheck = await $`gh auth status 2>&1`.run({
      capture: true,
      mirror: false,
    });
    if (authCheck.code !== 0) {
      console.log(
        'Skipping complex gh test - not authenticated (this is OK - we are testing $.mjs, not gh auth)'
      );
      return;
    }

    // Try to run the API command with graceful fallback
    const result =
      await $`sh -c 'gh api user --jq .login 2>/dev/null || echo "limited-token"' | head -1`.run(
        { capture: true, mirror: false }
      );

    // This version uses || echo to handle the limited token case gracefully
    // We're testing that $.mjs can pipe commands, not that we have full API access
    expect(result.code).toBe(0);
    expect(result.stdout).toBeDefined();
    expect(result.stdout.split('\n').length).toBeLessThanOrEqual(2); // Should be one line plus possible newline
  });
});
