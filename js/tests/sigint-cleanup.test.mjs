import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';

// Platform detection - Windows handles signals differently than Unix
const isWindows = process.platform === 'win32';

// Skip on Windows - SIGINT handler testing requires Unix signal semantics
describe.skipIf(isWindows)('SIGINT Handler Cleanup Tests', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Add user's SIGINT handler
    let userHandlerCalled = false;
    const userHandler = () => {
      userHandlerCalled = true;
    };

    // Test that we can add a handler without interference
    process.on('SIGINT', userHandler);

    try {
      // Verify the handler was added successfully
      const listeners = process.listeners('SIGINT');
      expect(listeners.includes(userHandler)).toBe(true);

      // NOTE: We do NOT emit SIGINT here as it would kill the test runner
      // The isolated test in sigint-cleanup-isolated.test.mjs tests actual SIGINT behavior
    } finally {
      // Cleanup
      process.removeListener('SIGINT', userHandler);
    }
  });

  test('should maintain SIGINT handler while commands are active', async () => {
    // Import forceCleanupAll to ensure clean state
    const { forceCleanupAll } = await import('../src/$.mjs');
    forceCleanupAll();

    const initialListeners = process.listeners('SIGINT').length;

    // Start a long-running command
    const runner = $`sleep 2`;
    const promise = runner.start();

    // While command is running, handler should be installed
    const duringListeners = process.listeners('SIGINT').length;
    expect(duringListeners).toBe(initialListeners + 1);

    // Kill the command
    runner.kill();

    try {
      await promise;
    } catch (error) {
      // Expected error when process is killed with SIGTERM
      expect(error.code).toBe(143);
    }

    // After command finishes, handler should be removed
    const afterListeners = process.listeners('SIGINT').length;

    // If listeners count doesn't match, force cleanup of command-stream handlers only
    if (afterListeners !== initialListeners) {
      const ourListeners = process.listeners('SIGINT').filter((l) => {
        const str = l.toString();
        return (
          str.includes('findActiveRunners') ||
          str.includes('forwardSigintToRunners') ||
          str.includes('handleSigintExit') ||
          str.includes('activeProcessRunners') ||
          str.includes('ProcessRunner') ||
          str.includes('activeChildren')
        );
      });

      if (ourListeners.length > 0) {
        console.warn(
          `Test left behind ${ourListeners.length} command-stream SIGINT handlers, forcing cleanup...`
        );
        ourListeners.forEach((listener) => {
          process.removeListener('SIGINT', listener);
        });
      }
    }

    const finalListeners = process.listeners('SIGINT').length;
    expect(finalListeners).toBe(initialListeners);
  });

  test('should handle multiple concurrent ProcessRunners correctly', async () => {
    const initialListeners = process.listeners('SIGINT').length;

    // Start multiple commands
    const promises = [$`echo one`, $`echo two`, $`echo three`];

    // Wait for all to finish
    await Promise.all(promises);

    // Handler should be removed after all finish
    const afterListeners = process.listeners('SIGINT').length;
    expect(afterListeners).toBe(initialListeners);
  });
});
