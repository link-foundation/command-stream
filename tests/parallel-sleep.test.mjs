import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $, shell, disableVirtualCommands } from '../src/$.mjs';

// Reset shell settings before each test to prevent interference
beforeEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  // Disable virtual commands for these tests to ensure system command behavior
  disableVirtualCommands();
});

// Reset shell settings after each test to prevent interference with other test files
afterEach(() => {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
});

describe('Parallel Sleep Commands Execution', () => {
  test('should execute 2 sleep commands in parallel', async () => {
    const startTime = Date.now();
    
    // Start 2 parallel sleep commands with 0.5 second delay each
    const promises = [
      $`sleep 0.5`,
      $`sleep 0.5`
    ];
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Both commands should complete successfully
    expect(results[0].code).toBe(0);
    expect(results[1].code).toBe(0);
    
    // Total duration should be closer to 0.5s (parallel) than 1.0s (sequential)
    // Allow some tolerance for system overhead
    expect(duration).toBeLessThan(800); // Should be much less than 800ms if truly parallel
    expect(duration).toBeGreaterThan(400); // Should be at least 400ms since sleep is 0.5s
  });

  test('should execute 3 sleep commands in parallel', async () => {
    const startTime = Date.now();
    
    // Start 3 parallel sleep commands with 0.3 second delay each
    const promises = [
      $`sleep 0.3`,
      $`sleep 0.3`,
      $`sleep 0.3`
    ];
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // All commands should complete successfully
    expect(results[0].code).toBe(0);
    expect(results[1].code).toBe(0);
    expect(results[2].code).toBe(0);
    
    // Total duration should be closer to 0.3s (parallel) than 0.9s (sequential)
    // Allow some tolerance for system overhead
    expect(duration).toBeLessThan(600); // Should be much less than 600ms if truly parallel
    expect(duration).toBeGreaterThan(250); // Should be at least 250ms since sleep is 0.3s
  });

  test('should execute mixed duration sleep commands in parallel', async () => {
    const startTime = Date.now();
    
    // Start 3 parallel sleep commands with different durations
    const promises = [
      $`sleep 0.2`,
      $`sleep 0.4`, 
      $`sleep 0.3`
    ];
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // All commands should complete successfully
    expect(results[0].code).toBe(0);
    expect(results[1].code).toBe(0);
    expect(results[2].code).toBe(0);
    
    // Total duration should be determined by the longest sleep (0.4s), not the sum (0.9s)
    // Allow some tolerance for system overhead
    expect(duration).toBeLessThan(650); // Should be much less than 650ms if truly parallel
    expect(duration).toBeGreaterThan(350); // Should be at least 350ms since longest sleep is 0.4s
  });

  test('should handle parallel sleep commands with output verification', async () => {
    const startTime = Date.now();
    
    // Start 2 parallel sleep commands that also produce output
    const promises = [
      $`sh -c 'echo "command1 start"; sleep 0.2; echo "command1 end"'`,
      $`sh -c 'echo "command2 start"; sleep 0.3; echo "command2 end"'`
    ];
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Both commands should complete successfully
    expect(results[0].code).toBe(0);
    expect(results[1].code).toBe(0);
    
    // Verify output content
    expect(results[0].stdout.trim()).toContain('command1 start');
    expect(results[0].stdout.trim()).toContain('command1 end');
    expect(results[1].stdout.trim()).toContain('command2 start');
    expect(results[1].stdout.trim()).toContain('command2 end');
    
    // Duration should be closer to max(0.2s, 0.3s) = 0.3s, not sum = 0.5s
    expect(duration).toBeLessThan(550); // Should be much less than 550ms if truly parallel
    expect(duration).toBeGreaterThan(250); // Should be at least 250ms since longest sleep is 0.3s
  });

  test('should maintain individual command execution context in parallel', async () => {
    // Test that each parallel command maintains its own execution environment
    const commands = [
      $`sh -c 'VAR="value1"; sleep 0.1; echo "Command 1: $VAR"'`,
      $`sh -c 'VAR="value2"; sleep 0.1; echo "Command 2: $VAR"'`,
      $`sh -c 'VAR="value3"; sleep 0.1; echo "Command 3: $VAR"'`
    ];
    
    const results = await Promise.all(commands);
    
    // All commands should succeed
    results.forEach(result => {
      expect(result.code).toBe(0);
    });
    
    // Each should have its own variable value
    expect(results[0].stdout.trim()).toBe('Command 1: value1');
    expect(results[1].stdout.trim()).toBe('Command 2: value2');
    expect(results[2].stdout.trim()).toBe('Command 3: value3');
  });
});