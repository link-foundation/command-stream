import { beforeEach, afterEach } from 'bun:test';
import { resetGlobalState } from '../js/src/$.mjs';
import { existsSync } from 'fs';

// Platform detection helpers
export const isWindows = process.platform === 'win32';
export const isUnix = process.platform !== 'win32';

// Save the original working directory when tests start
const originalCwd = process.cwd();

// Trace function for debugging
function trace(message) {
  if (process.env.DEBUG || process.env.TRACE) {
    const timestamp = new Date().toISOString();
    console.error(`[TRACE ${timestamp}] [test-helper] ${message}`);
  }
}

trace(`Original working directory: ${originalCwd}`);

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

// Reset global state before and after each test to prevent interference
// Use async to ensure cleanup completes
beforeEach(async () => {
  // CRITICAL: Restore working directory first - MUST succeed for spawn to work
  const currentDir = process.cwd();
  if (currentDir !== originalCwd) {
    trace(`beforeEach: Restoring cwd from ${currentDir} to ${originalCwd}`);
  }
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
        '[test-helper] FATAL: Cannot set working directory in beforeEach'
      );
      trace('FATAL: Cannot set working directory in beforeEach');
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
      `[test-helper] WARNING: Failed to restore cwd! Expected: ${originalCwd}, Got: ${finalCwd}`
    );
    // Try one more time
    try {
      process.chdir(originalCwd);
      const verifiedCwd = process.cwd();
      if (verifiedCwd === originalCwd) {
        trace('Successfully restored on second attempt');
      } else {
        throw new Error(
          `[test-helper] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${verifiedCwd}`
        );
      }
    } catch (e) {
      throw new Error(
        `[test-helper] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${finalCwd}`
      );
    }
  }

  // Give a tiny bit of time for any async cleanup to complete
  await new Promise((resolve) => setTimeout(resolve, 1));
});

afterEach(async () => {
  // CRITICAL: Clean up and restore state after each test
  const currentDir = process.cwd();
  if (currentDir !== originalCwd) {
    trace(`afterEach: Restoring cwd from ${currentDir} to ${originalCwd}`);
  }
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
        '[test-helper] FATAL: Cannot set working directory in afterEach'
      );
      trace('FATAL: Cannot set working directory in afterEach');
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
      `[test-helper] WARNING: Failed to restore cwd! Expected: ${originalCwd}, Got: ${finalCwd}`
    );
    // Try one more time
    try {
      process.chdir(originalCwd);
      const verifiedCwd = process.cwd();
      if (verifiedCwd === originalCwd) {
        trace('Successfully restored on second attempt');
      } else {
        throw new Error(
          `[test-helper] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${verifiedCwd}`
        );
      }
    } catch (e) {
      throw new Error(
        `[test-helper] CRITICAL: Cannot restore to original directory ${originalCwd}, stuck in ${finalCwd}`
      );
    }
  }

  // Give a tiny bit of time for any async cleanup to complete
  await new Promise((resolve) => setTimeout(resolve, 1));
});

export { resetGlobalState };
