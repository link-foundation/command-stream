import { test, expect, describe } from 'bun:test';
import { $ } from '../src/$.mjs';

describe('SIGINT Handler Cleanup Tests', () => {
  test('should remove SIGINT handler when all ProcessRunners finish', async () => {
    // Check initial state
    const initialListeners = process.listeners('SIGINT').length;
    
    // Run a quick command that finishes immediately
    const result = await $`echo hello`;
    expect(result.code).toBe(0);
    
    // After command finishes, SIGINT handler should be removed
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should not interfere with user SIGINT handlers after commands finish', async () => {
    // Run a command and let it finish
    await $`echo test`;
    
    // Wait a bit to ensure all cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Add user's SIGINT handler
    let userHandlerCalled = false;
    const userHandler = () => {
      userHandlerCalled = true;
    };
    process.on('SIGINT', userHandler);
    
    try {
      // Emit SIGINT
      process.emit('SIGINT');
      
      // User handler should have been called
      expect(userHandlerCalled).toBe(true);
    } finally {
      // Cleanup
      process.removeListener('SIGINT', userHandler);
    }
  });

  test('should maintain SIGINT handler while commands are active', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start a long-running command
    const runner = $`sleep 2`;
    const promise = runner.start();
    
    // While command is running, handler should be installed
    const duringListeners = process.listeners('SIGINT').length;
    expect(duringListeners).toBe(initialListeners + 1);
    
    // Kill the command
    runner.kill();
    await promise;
    
    // After command finishes, handler should be removed
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });

  test('should handle multiple concurrent ProcessRunners correctly', async () => {
    const initialListeners = process.listeners('SIGINT').length;
    
    // Start multiple commands
    const promises = [
      $`echo one`,
      $`echo two`,
      $`echo three`
    ];
    
    // Wait for all to finish
    await Promise.all(promises);
    
    // Handler should be removed after all finish
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });
});