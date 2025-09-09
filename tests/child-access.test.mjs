import { describe, it, expect } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

describe('Child Process Access (Issue #20)', () => {
  it('should provide immediate access to child object for virtual commands', () => {
    const runner = $`sleep 2`;
    
    // Child should be available immediately
    expect(runner.child).toBeDefined();
    expect(runner.child).not.toBeNull();
    
    // Should have a kill method
    expect(typeof runner.child.kill).toBe('function');
    
    // Should be marked as virtual child
    expect(runner.child._isVirtualChild).toBe(true);
    
    // Should have expected properties (even if null/false for virtual)
    expect(runner.child).toHaveProperty('pid');
    expect(runner.child).toHaveProperty('stdin');
    expect(runner.child).toHaveProperty('stdout');
    expect(runner.child).toHaveProperty('stderr');
    expect(runner.child).toHaveProperty('killed');
  });

  it('should allow killing virtual commands via child.kill()', async () => {
    const runner = $`sleep 3`;
    
    // Should be able to kill immediately without await
    expect(() => {
      runner.child.kill('SIGTERM');
    }).not.toThrow();
    
    // Process should be marked as cancelled
    expect(runner._cancelled).toBe(true);
    expect(runner._cancellationSignal).toBe('SIGTERM');
    
    // Process should complete with appropriate exit code
    const result = await runner;
    expect(result.code).toBeGreaterThan(0); // Should exit with error code
  });

  it('should provide access to real child process for real commands', async () => {
    if (process.platform === 'win32') return; // Skip on Windows
    
    const runner = $`/bin/sleep 1`;
    
    // Start the process and give it a moment to spawn
    const promise = runner.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Child should be available and be a real child process
    expect(runner.child).toBeDefined();
    expect(runner.child).not.toBeNull();
    expect(runner.child._isVirtualChild).toBeUndefined(); // Not a virtual child
    expect(runner.child.pid).toBeGreaterThan(0);
    
    // Should be able to kill it
    expect(() => {
      runner.child.kill('SIGTERM');
    }).not.toThrow();
    
    const result = await promise;
    expect(result.code).toBe(143); // 128 + 15 (SIGTERM)
  });

  it('should handle kill() method calls on both virtual and real commands', async () => {
    // Test virtual command
    const virtualRunner = $`sleep 2`;
    expect(() => virtualRunner.child.kill('SIGTERM')).not.toThrow();
    
    // Test real command
    if (process.platform !== 'win32') {
      const realRunner = $`/bin/sleep 2`;
      realRunner.start();
      await new Promise(resolve => setTimeout(resolve, 100)); // Let it start
      expect(() => realRunner.child.kill('SIGTERM')).not.toThrow();
    }
  });

  it('should return null for finished processes', async () => {
    const runner = $`echo "test"`;
    const result = await runner;
    
    // After completion, child should be null
    expect(runner.child).toBeNull();
    expect(result.stdout.trim()).toBe('test');
  });
});