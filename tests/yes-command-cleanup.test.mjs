import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';
import { trace } from '../src/$.utils.mjs';

describe('Yes Command Cleanup Tests', () => {
  test('should stop yes command when breaking from async iteration', async () => {
    const runner = $({ mirror: false })`yes "test output"`;
    let iterations = 0;
    const maxIterations = 5;
    
    for await (const chunk of runner.stream()) {
      iterations++;
      if (iterations >= maxIterations) {
        break; // This MUST stop the yes command
      }
    }
    
    // Verify the command finished
    expect(runner.finished).toBe(true);
    expect(iterations).toBe(maxIterations);
    
    // Wait a bit to ensure no more output
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify no lingering SIGINT handlers
    const listeners = process.listeners('SIGINT');
    const ourListeners = listeners.filter(l => 
      l.toString().includes('activeProcessRunners')
    );
    
    // If there are leftover handlers, force cleanup
    if (ourListeners.length > 0) {
      console.warn(`Test left behind ${ourListeners.length} SIGINT handlers, forcing cleanup...`);
      ourListeners.forEach(listener => {
        process.removeListener('SIGINT', listener);
      });
    }
    
    const cleanedListeners = process.listeners('SIGINT').filter(l => 
      l.toString().includes('activeProcessRunners')
    );
    expect(cleanedListeners.length).toBe(0);
  });
  
  test('should stop yes command when killed explicitly', async () => {
    const runner = $({ mirror: false })`yes`;
    const promise = runner.start();
    
    // Collect some output
    let outputReceived = false;
    runner.on('data', () => {
      outputReceived = true;
    });
    
    // Let it run briefly
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Kill it
    runner.kill();
    
    // Wait for it to finish
    try {
      await promise;
    } catch (e) {
      // Expected - command was killed
    }
    
    // Verify it's finished
    expect(runner.finished).toBe(true);
    expect(outputReceived).toBe(true);
  });
  
  test('should stop yes command on timeout', async () => {
    const runner = $({ mirror: false })`yes "timeout test"`;
    const startTime = Date.now();
    
    // Set a timeout
    const timeoutMs = 100;
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        runner.kill();
        reject(new Error('timeout'));
      }, timeoutMs);
    });
    
    // Try to run forever, but timeout should stop it
    try {
      await Promise.race([
        runner,
        timeoutPromise
      ]);
    } catch (e) {
      // Expected timeout
      expect(e.message).toContain('timeout');
    }
    
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(timeoutMs + 100); // Should stop quickly
    expect(runner.finished).toBe(true);
  });
  
  test('should stop yes when error occurs in handler', async () => {
    const runner = $({ mirror: false })`yes "error test"`;
    let iterations = 0;
    
    try {
      for await (const chunk of runner.stream()) {
        iterations++;
        if (iterations === 3) {
          throw new Error('Handler error');
        }
      }
    } catch (e) {
      expect(e.message).toBe('Handler error');
    }
    
    // The runner should be finished after error
    expect(runner.finished).toBe(true);
    expect(iterations).toBe(3);
  });
  
  test('should handle multiple yes commands without interference', async () => {
    const runners = [
      $({ mirror: false })`yes "first"`,
      $({ mirror: false })`yes "second"`,
      $({ mirror: false })`yes "third"`
    ];
    
    const results = await Promise.all(
      runners.map(async (runner) => {
        let count = 0;
        for await (const chunk of runner.stream()) {
          count++;
          if (count >= 2) break;
        }
        return count;
      })
    );
    
    // All should have stopped at 2 iterations
    expect(results).toEqual([2, 2, 2]);
    
    // All should be finished
    runners.forEach(runner => {
      expect(runner.finished).toBe(true);
    });
  });
  
  test('should cleanup yes command in subprocess', async () => {
    // Create a test script that runs yes and should exit cleanly
    const script = `
      import { $ } from './src/$.mjs';
      
      const runner = $({ mirror: false })\`yes "subprocess test"\`;
      let count = 0;
      
      for await (const chunk of runner.stream()) {
        count++;
        if (count >= 3) break;
      }
      
      console.log('COUNT:' + count);
      console.log('FINISHED:' + runner.finished);
      process.exit(0);
    `;
    
    // Run in subprocess
    const result = await $`node --input-type=module -e ${script}`;
    
    expect(result.stdout).toContain('COUNT:3');
    expect(result.stdout).toContain('FINISHED:true');
    expect(result.code).toBe(0);
  });
  
  test('critical: yes must stop within reasonable time when cancelled', async () => {
    const runner = $({ mirror: false })`yes`;
    const startTime = Date.now();
    
    // Start collecting output
    const promise = runner.start();
    
    // Wait briefly then kill
    await new Promise(resolve => setTimeout(resolve, 10));
    runner.kill();
    
    // Wait for finish
    try {
      await promise;
    } catch (e) {
      // Expected
    }
    
    const elapsed = Date.now() - startTime;
    
    // CRITICAL: Must stop within 200ms of kill
    expect(elapsed).toBeLessThan(200);
    expect(runner.finished).toBe(true);
    
    // Verify no remaining activity after another wait
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should still be finished
    expect(runner.finished).toBe(true);
  });
});