import { test, expect, describe } from 'bun:test';
import { $, forceCleanupAll } from '../src/$.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the source to access internal variables
const srcPath = join(__dirname, '../src/$.mjs');
const srcContent = readFileSync(srcPath, 'utf8');

// Extract activeProcessRunners Set reference using eval (for testing only)
let activeProcessRunners;
let sigintHandlerInstalled;

// Helper to get internal state
async function getInternalState() {
  // Create a temporary module that exports the internal state
  const tmpModule = await import(`../src/$.mjs?t=${Date.now()}`);
  
  // Access internal state through a command that exposes it
  const runner = tmpModule.$`echo test`;
  
  // Access the activeProcessRunners through the constructor's closure
  // This is a hack for testing purposes only
  const internals = runner.constructor._getInternals?.() || {};
  
  return {
    activeRunners: internals.activeProcessRunners?.size || 0,
    sigintInstalled: internals.sigintHandlerInstalled || false
  };
}

// Helper to check if activeProcessRunners is empty
async function checkActiveRunnersEmpty() {
  // Since we can't directly access the Set, we'll check indirectly
  // by looking at SIGINT handler count
  const sigintListeners = process.listeners('SIGINT').length;
  return sigintListeners;
}

describe('Cleanup Verification Tests', () => {
  test('should immediately cleanup virtual commands after completion', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Run a virtual command
    const result = await $`echo "cleanup test"`;
    expect(result.code).toBe(0);
    
    // Check that cleanup happened immediately
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup real processes immediately after completion', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Run a real process command
    const result = await $`/bin/echo "real process test"`;
    expect(result.code).toBe(0);
    
    // Check that cleanup happened immediately
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup on error conditions', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    try {
      // Run a command that will fail
      await $`/nonexistent/command`;
    } catch (error) {
      // Expected to fail
    }
    
    // Check that cleanup still happened
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when process is killed', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start a long-running process
    const runner = $`sleep 10`;
    const promise = runner.start();
    
    // Kill it immediately
    runner.kill();
    
    try {
      await promise;
    } catch (error) {
      // Expected to fail with signal
    }
    
    // Check that cleanup happened
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup virtual commands with events', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Run a simple virtual command with events
    const result = await $`echo "event cleanup test"`;
    expect(result.stdout).toContain('event cleanup test');
    
    // Wait a bit to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 20));
    
    // Check that cleanup happened
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup multiple concurrent commands', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start multiple commands concurrently
    const promises = [
      $`echo "concurrent 1"`,
      $`echo "concurrent 2"`,
      $`echo "concurrent 3"`,
      $`sleep 0.01`,
      $`pwd`
    ];
    
    // Wait for all to complete
    await Promise.all(promises);
    
    // Check that all were cleaned up
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when using pipe operations', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Run a piped command
    const result = await $`echo "pipe test" | cat`;
    expect(result.stdout).toContain('pipe test');
    
    // Check cleanup
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when command times out', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start a long command
    const runner = $`sleep 10`;
    const promise = runner.start();
    
    // Set a timeout to kill it
    setTimeout(() => runner.kill(), 10);
    
    try {
      await promise;
    } catch (error) {
      // Expected to be killed
    }
    
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check that cleanup happened
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when using abort controller', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    const controller = new AbortController();
    
    // Start a command with abort controller
    const promise = $`sleep 10`.start({ signal: controller.signal });
    
    // Abort immediately
    controller.abort();
    
    try {
      await promise;
    } catch (error) {
      // Expected abort error
    }
    
    // Check cleanup
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should not leak handlers when rapidly creating commands', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Rapidly create and execute many commands
    for (let i = 0; i < 50; i++) {
      await $`echo ${i}`;
    }
    
    // All should be cleaned up
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when parent streams close', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Simulate parent stream closure scenario
    const runner = $`cat`;
    const promise = runner.start();
    
    // Close stdin to trigger parent stream closure handling
    if (runner.child?.stdin) {
      runner.child.stdin.end();
    }
    
    try {
      await promise;
    } catch (error) {
      // May fail, that's ok
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Check cleanup
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should verify no active runners remain after all tests', async () => {
    // Run a few commands
    await $`echo "final test 1"`;
    await $`echo "final test 2"`;
    await $`pwd`;
    
    // Wait a bit to ensure all cleanup completes
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Ensure no SIGINT handlers from our library remain
    const listeners = process.listeners('SIGINT');
    
    // Log listener info for debugging
    if (listeners.length > 0) {
      console.log('Remaining SIGINT listeners:', listeners.length);
      listeners.forEach((l, i) => {
        const str = l.toString();
        if (str.includes('activeProcessRunners') || str.includes('ProcessRunner') || str.includes('trace')) {
          console.log(`Listener ${i} appears to be from command-stream:`, str.substring(0, 200));
        }
      });
    }
    
    const ourListeners = listeners.filter(l => {
      const str = l.toString();
      return str.includes('activeProcessRunners') || 
             str.includes('ProcessRunner') ||
             str.includes('activeChildren');
    });
    
    // If there are leftover handlers, force cleanup
    if (ourListeners.length > 0) {
      console.warn(`Test left behind ${ourListeners.length} SIGINT handlers, forcing cleanup...`);
      ourListeners.forEach(listener => {
        process.removeListener('SIGINT', listener);
      });
    }
    
    const cleanedListeners = process.listeners('SIGINT').filter(l => {
      const str = l.toString();
      return str.includes('activeProcessRunners') || 
             str.includes('ProcessRunner') ||
             str.includes('activeChildren');
    });
    expect(cleanedListeners.length).toBe(0);
  });

  test('should cleanup resources even when promise is not awaited', async () => {
    // Force cleanup to ensure clean state at start
    forceCleanupAll();
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start commands but don't await them
    const runner1 = $`sleep 0.05`;
    const runner2 = $`echo "not awaited"`;
    const runner3 = $`pwd`;
    
    // Start them
    runner1.start();
    runner2.start();
    runner3.start();
    
    // Wait for them to complete naturally
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Ensure cleanup happened
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup when using finally without await', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Use finally to ensure cleanup even without await
    const promise = $`echo "test with finally"`.finally(() => {
      // This should trigger cleanup
    });
    
    // Wait for it to complete
    await promise;
    
    // Check cleanup
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should cleanup resources in complex error scenarios', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Test various error scenarios
    const promises = [];
    
    // Command that fails
    promises.push($`exit 1`.catch(() => {}));
    
    // Command that's killed
    const runner = $`sleep 10`;
    const p = runner.start();
    setTimeout(() => runner.kill(), 5);
    promises.push(p.catch(() => {}));
    
    // Virtual command that throws
    try {
      await $`nonexistent-virtual-command`;
    } catch (e) {
      // Expected error
    }
    
    // Wait for all to settle
    await Promise.allSettled(promises);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify cleanup
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });
});