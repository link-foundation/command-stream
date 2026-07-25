import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell } from '../src/$.mjs';

// Reset shell settings before each test to prevent interference
beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

// Reset shell settings after each test to prevent interference with other test files
afterEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

describe('.quiet() method', () => {
  test('should suppress console output when .quiet() is called', async () => {
    // Capture stdout to verify output is suppressed
    let capturedStdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      capturedStdout += chunk.toString();
      return true;
    };

    try {
      const result = await $`echo "test output"`.quiet();

      // Restore original stdout
      process.stdout.write = originalWrite;

      // The result should still contain the output
      expect(result.stdout.trim()).toBe('test output');

      // But nothing should have been written to console
      expect(capturedStdout).toBe('');
    } finally {
      // Ensure stdout is restored even if test fails
      process.stdout.write = originalWrite;
    }
  });

  test('should work with chaining after .quiet()', async () => {
    let capturedStdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      capturedStdout += chunk.toString();
      return true;
    };

    try {
      const result = await $`echo "chained test"`.quiet();

      process.stdout.write = originalWrite;

      expect(result.stdout.trim()).toBe('chained test');
      expect(capturedStdout).toBe('');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('should allow normal output without .quiet()', async () => {
    // Capture stdout to verify output is shown
    let capturedStdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      capturedStdout += chunk.toString();
      return true;
    };

    try {
      const result = await $`echo "normal output"`;

      process.stdout.write = originalWrite;

      // The result should contain the output
      expect(result.stdout.trim()).toBe('normal output');

      // And it should have been written to console (mirrored)
      expect(capturedStdout).toContain('normal output');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('should return ProcessRunner instance for chaining', () => {
    const runner = $`echo "test"`.quiet();

    // Should return a ProcessRunner that can be awaited
    expect(runner).toBeDefined();
    expect(typeof runner.then).toBe('function');
    expect(typeof runner.quiet).toBe('function');
  });

  test('should work with stderr output', async () => {
    let capturedStderr = '';
    const originalWrite = process.stderr.write;
    process.stderr.write = (chunk) => {
      capturedStderr += chunk.toString();
      return true;
    };

    try {
      const result = await $`node -e "console.error('error message')"`.quiet();

      process.stderr.write = originalWrite;

      // The result should still contain stderr
      expect(result.stderr.trim()).toContain('error message');

      // But nothing should have been written to console
      expect(capturedStderr).toBe('');
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  test('should work similar to zx quiet() behavior', async () => {
    // Test the example from the issue
    let capturedStdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      capturedStdout += chunk.toString();
      return true;
    };

    try {
      // Simulate the gh api command from the issue (using echo as substitute)
      const result = await $`echo '{"owner": "test", "files": {}}'`.quiet();

      process.stdout.write = originalWrite;

      // Should capture the output
      expect(result.stdout).toContain('owner');

      // But not print to console
      expect(capturedStdout).toBe('');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
