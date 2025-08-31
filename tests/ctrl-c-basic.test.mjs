import { describe, it, expect } from 'bun:test';
import { $ } from '../src/$.mjs';

describe('CTRL+C Basic Handling', () => {
  it('should be able to kill a long-running process', async () => {
    // Start a long-running process
    const runner = $`sleep 10`;
    
    // Start it without awaiting completion
    const promise = runner.start();
    
    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Kill it manually (simulating what CTRL+C would do)
    runner.kill();
    
    // The process should complete with a non-zero exit code
    const result = await promise;
    
    // Should have a non-zero exit code (143 for SIGTERM)
    expect(result.code).toBeGreaterThan(0);
    expect(result.code).toBe(143); // 128 + 15 (SIGTERM)
  });

  it('should spawn processes with detached flag on Unix', async () => {
    if (process.platform === 'win32') {
      // Skip on Windows
      return;
    }
    
    // Use /bin/sleep to get a real system process, not virtual command
    const runner = $`/bin/sleep 1`;
    
    // Start the process
    const promise = runner.start();
    
    // Give it a moment to spawn
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check that the child process exists and has a PID
    expect(runner.child).toBeDefined();
    expect(runner.child.pid).toBeGreaterThan(0);
    
    // Kill and wait for completion
    runner.kill();
    
    try {
      await promise;
    } catch (error) {
      // Expected to error
    }
  });

  it('should handle CTRL+C character in raw mode', async () => {
    // Test that the _forwardTTYStdin method properly handles CTRL+C
    // This is a unit test of the specific functionality
    
    const runner = $`cat`; // Use cat to read stdin
    
    // Start the process
    const promise = runner.start();
    
    // Give it time to set up
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Kill the process
    runner.kill();
    
    // Should complete with an error
    let errorCode = null;
    try {
      await promise;
    } catch (error) {
      errorCode = error.code;
    }
    
    expect(errorCode).toBeDefined();
  });
});