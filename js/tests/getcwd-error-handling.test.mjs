import { expect, test, describe } from "bun:test";
import { $ } from '../src/$.mjs';

describe('getcwd() error handling', () => {
  test('should handle getcwd() failures in subshells gracefully', async () => {
    const originalDir = process.cwd();
    const originalCwd = process.cwd;
    let cwdCallCount = 0;
    
    try {
      // Mock process.cwd to fail when called from _runSubshell
      process.cwd = function() {
        cwdCallCount++;
        const stack = new Error().stack;
        if (stack.includes('_runSubshell') && cwdCallCount > 1) {
          const error = new Error('getcwd() failed: No such file or directory');
          error.errno = -2;
          error.code = 'ENOENT';
          throw error;
        }
        return originalCwd.call(this);
      };
      
      // This should not throw despite the getcwd() failure
      const result = await $`(echo "test subshell")`;
      expect(result.stdout.toString().trim()).toBe('test subshell');
      expect(result.code).toBe(0);
      
    } finally {
      // Restore original process.cwd
      process.cwd = originalCwd;
      try {
        process.chdir(originalDir);
      } catch (e) {
        // Ignore restoration errors in test
      }
    }
  });

  test('should handle getcwd() failures during directory restoration', async () => {
    const originalDir = process.cwd();
    const originalCwd = process.cwd;
    let restorePhase = false;
    
    try {
      // Mock process.cwd to fail during directory restoration
      process.cwd = function() {
        const stack = new Error().stack;
        if (restorePhase && stack.includes('finally')) {
          const error = new Error('getcwd() failed: No such file or directory');
          error.errno = -2;
          error.code = 'ENOENT';
          throw error;
        }
        return originalCwd.call(this);
      };
      
      // Enable restore phase failure after command starts
      setTimeout(() => { restorePhase = true; }, 10);
      
      // This should complete successfully despite restoration issues
      const result = await $`(echo "test restoration")`;
      expect(result.stdout.toString().trim()).toBe('test restoration');
      expect(result.code).toBe(0);
      
    } finally {
      // Restore original process.cwd
      process.cwd = originalCwd;
      try {
        process.chdir(originalDir);
      } catch (e) {
        // Ignore restoration errors in test
      }
    }
  });

  test('should continue working after getcwd() errors', async () => {
    const originalDir = process.cwd();
    const originalCwd = process.cwd;
    let failureCount = 0;
    
    try {
      // Mock process.cwd to fail a few times then succeed
      process.cwd = function() {
        const stack = new Error().stack;
        if (stack.includes('_runSubshell') && failureCount < 2) {
          failureCount++;
          const error = new Error('getcwd() failed: No such file or directory');
          error.errno = -2;
          error.code = 'ENOENT';
          throw error;
        }
        return originalCwd.call(this);
      };
      
      // First command should work despite getcwd() failure
      const result1 = await $`(echo "first")`;
      expect(result1.stdout.toString().trim()).toBe('first');
      
      // Second command should work despite getcwd() failure  
      const result2 = await $`(echo "second")`;
      expect(result2.stdout.toString().trim()).toBe('second');
      
      // Third command should work normally (no more failures)
      const result3 = await $`(echo "third")`;
      expect(result3.stdout.toString().trim()).toBe('third');
      
    } finally {
      // Restore original process.cwd
      process.cwd = originalCwd;
      try {
        process.chdir(originalDir);
      } catch (e) {
        // Ignore restoration errors in test
      }
    }
  });
});