/**
 * Tests for issue #38: The library uses error.code instead of error.exitCode
 * Verifies that both error.code and error.exitCode are available for backward compatibility
 * and Node.js standard compatibility.
 */

import { describe, test, expect } from 'bun:test';
import { $, shell } from '../src/$.mjs';

describe('exitCode compatibility (issue #38)', () => {
  test('should provide both error.code and error.exitCode properties', async () => {
    shell.errexit(true);
    
    try {
      await $`exit 42`;
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      // Both properties should exist and be equal
      expect(error.code).toBe(42);
      expect(error.exitCode).toBe(42);
      expect(error.code).toBe(error.exitCode);
      
      // Standard Node.js error properties should also exist
      expect(error.message).toContain('Command failed with exit code 42');
      expect(error.result).toBeDefined();
      expect(error.result.code).toBe(42);
    }
  });

  test('should maintain backward compatibility with existing error.code usage', async () => {
    shell.errexit(true);
    
    try {
      await $`exit 5`;
      expect(true).toBe(false);
    } catch (error) {
      // Traditional command-stream pattern should still work
      if (error.code === 5) {
        expect(true).toBe(true); // This should execute
      } else {
        expect(true).toBe(false); // This should not execute
      }
      
      // New Node.js standard pattern should also work
      if (error.exitCode === 5) {
        expect(true).toBe(true); // This should execute
      } else {
        expect(true).toBe(false); // This should not execute
      }
    }
  });

  test('should provide exitCode in pipeline errors', async () => {
    shell.errexit(true);
    shell.pipefail(true);
    
    try {
      await $`echo "test" | exit 3 | echo "after"`;
      expect(true).toBe(false);
    } catch (error) {
      expect(error.code).toBe(3);
      expect(error.exitCode).toBe(3);
      expect(error.code).toBe(error.exitCode);
    }
  });

  test('should work with different exit codes', async () => {
    shell.errexit(true);
    const testCodes = [1, 2, 127, 255];
    
    for (const code of testCodes) {
      try {
        await $`exit ${code}`;
        expect(true).toBe(false);
      } catch (error) {
        expect(error.code).toBe(code);
        expect(error.exitCode).toBe(code);
        expect(error.code).toBe(error.exitCode);
      }
    }
  });

  test('should handle file system errors with both properties', async () => {
    try {
      await $`ls /nonexistent/directory/path/that/should/not/exist`;
    } catch (error) {
      // Both properties should exist for file system errors
      expect(error.code).toBeDefined();
      expect(error.exitCode).toBeDefined();
      expect(error.code).toBe(error.exitCode);
      expect(typeof error.code).toBe('number');
      expect(typeof error.exitCode).toBe('number');
    }
  });
});