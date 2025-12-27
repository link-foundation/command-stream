/**
 * Test cleanup utilities for command-stream tests
 *
 * Provides functions to be called in beforeEach/afterEach hooks
 * within describe blocks.
 *
 * Usage:
 * ```js
 * import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
 * import { describe, beforeEach, afterEach } from 'bun:test';
 *
 * describe('Your test suite', () => {
 *   beforeEach(beforeTestCleanup);
 *   afterEach(afterTestCleanup);
 *
 *   // Your tests here
 * });
 * ```
 */

import { resetGlobalState } from '../src/$.mjs';
import { existsSync } from 'fs';

// Save the original working directory when module loads
const originalCwd = process.cwd();

// Trace function for debugging
function trace(message) {
  if (process.env.DEBUG || process.env.TRACE) {
    const timestamp = new Date().toISOString();
    console.error(`[TRACE ${timestamp}] [test-cleanup] ${message}`);
  }
}

trace(`Module loaded - original working directory: ${originalCwd}`);

/**
 * Cleanup function to call in beforeEach hook
 */
export async function beforeTestCleanup() {
  trace('beforeTestCleanup running');

  // CRITICAL: Restore working directory first - MUST succeed for spawn to work
  const currentDir = process.cwd();
  if (currentDir !== originalCwd) {
    trace(`Restoring cwd from ${currentDir} to ${originalCwd}`);
    try {
      // Force restoration regardless of current state
      process.chdir(originalCwd);
    } catch (e) {
      // Original directory might be gone, try fallbacks
      try {
        if (existsSync(originalCwd)) {
          process.chdir(originalCwd);
        } else if (existsSync('/workspace/command-stream')) {
          process.chdir('/workspace/command-stream');
        } else if (process.env.HOME && existsSync(process.env.HOME)) {
          process.chdir(process.env.HOME);
        } else {
          process.chdir('/');
        }
      } catch (e2) {
        console.error(
          '[test-cleanup] FATAL: Cannot set working directory in beforeTestCleanup'
        );
        trace('FATAL: Cannot set working directory');
      }
    }
  }

  // Call the comprehensive reset
  resetGlobalState();

  // Extra safety: ensure we're in a valid directory after reset
  try {
    process.cwd(); // This will throw if we're in a bad state
  } catch (e) {
    // Force to a known good directory
    process.chdir(originalCwd);
  }

  // VERIFY: Ensure we actually restored to the original directory
  const finalCwd = process.cwd();
  if (finalCwd !== originalCwd && existsSync(originalCwd)) {
    console.error(
      `[test-cleanup] WARNING: Failed to restore cwd! Expected: ${originalCwd}, Got: ${finalCwd}`
    );
    // Try one more time
    try {
      process.chdir(originalCwd);
      const verifiedCwd = process.cwd();
      if (verifiedCwd === originalCwd) {
        trace('Successfully restored on second attempt');
      } else {
        throw new Error(
          `[test-cleanup] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${verifiedCwd}`
        );
      }
    } catch (e) {
      throw new Error(
        `[test-cleanup] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${finalCwd}`
      );
    }
  }

  // Give a tiny bit of time for any async cleanup to complete
  await new Promise((resolve) => setTimeout(resolve, 1));
  trace('beforeTestCleanup completed');
}

/**
 * Cleanup function to call in afterEach hook
 */
export async function afterTestCleanup() {
  trace('afterTestCleanup running');

  // CRITICAL: Clean up and restore state after each test
  const currentDir = process.cwd();
  if (currentDir !== originalCwd) {
    trace(`Restoring cwd from ${currentDir} to ${originalCwd}`);
    try {
      // Force restoration regardless of current state
      process.chdir(originalCwd);
    } catch (e) {
      // Original directory might be gone, try fallbacks
      try {
        if (existsSync(originalCwd)) {
          process.chdir(originalCwd);
        } else if (existsSync('/workspace/command-stream')) {
          process.chdir('/workspace/command-stream');
        } else if (process.env.HOME && existsSync(process.env.HOME)) {
          process.chdir(process.env.HOME);
        } else {
          process.chdir('/');
        }
      } catch (e2) {
        console.error(
          '[test-cleanup] FATAL: Cannot set working directory in afterTestCleanup'
        );
        trace('FATAL: Cannot set working directory');
      }
    }
  }

  // Call the comprehensive reset
  resetGlobalState();

  // Extra safety: ensure we're in a valid directory after reset
  try {
    process.cwd(); // This will throw if we're in a bad state
  } catch (e) {
    // Force to a known good directory
    process.chdir(originalCwd);
  }

  // VERIFY: Ensure we actually restored to the original directory
  const finalCwd = process.cwd();
  if (finalCwd !== originalCwd && existsSync(originalCwd)) {
    console.error(
      `[test-cleanup] WARNING: Failed to restore cwd in afterEach! Expected: ${originalCwd}, Got: ${finalCwd}`
    );
    // Try one more time
    try {
      process.chdir(originalCwd);
      const verifiedCwd = process.cwd();
      if (verifiedCwd === originalCwd) {
        trace('Successfully restored on second attempt in afterEach');
      } else {
        throw new Error(
          `[test-cleanup] CRITICAL: Cannot restore to original directory ${originalCwd} in afterEach, stuck in ${verifiedCwd}`
        );
      }
    } catch (e) {
      throw new Error(
        `[test-cleanup] CRITICAL: Cannot restore to original directory ${originalCwd} in afterEach, stuck in ${finalCwd}`
      );
    }
  }

  // Give a tiny bit of time for any async cleanup to complete
  await new Promise((resolve) => setTimeout(resolve, 1));
  trace('afterTestCleanup completed');
}

// Install a process exit handler to ensure cleanup even on crash
process.on('beforeExit', () => {
  try {
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  } catch (e) {
    // Ignore
  }
});

// Export resetGlobalState for direct use if needed
export { resetGlobalState };

// Export original cwd for verification in tests
export { originalCwd };
