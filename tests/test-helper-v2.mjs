import { beforeEach, afterEach } from 'bun:test';
import { resetGlobalState } from '../src/$.mjs';
import { existsSync } from 'fs';

// Save the original working directory when tests start
const originalCwd = process.cwd();

// Trace function for debugging
function trace(message) {
  if (process.env.DEBUG || process.env.TRACE) {
    const timestamp = new Date().toISOString();
    console.error(`[TRACE ${timestamp}] [test-helper-v2] ${message}`);
  }
}

trace(`Original working directory: ${originalCwd}`);

// Function to set up test hooks
export function setupTestHooks() {
  trace('Setting up test hooks');
  
  beforeEach(async () => {
    trace('beforeEach hook running');
    // CRITICAL: Restore working directory first - MUST succeed for spawn to work
    const currentDir = process.cwd();
    if (currentDir !== originalCwd) {
      trace(`beforeEach: Restoring cwd from ${currentDir} to ${originalCwd}`);
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
          console.error('[test-helper-v2] FATAL: Cannot set working directory in beforeEach');
          trace('FATAL: Cannot set working directory in beforeEach');
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
    
    // Give a tiny bit of time for any async cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1));
    trace('beforeEach hook completed');
  });

  afterEach(async () => {
    trace('afterEach hook running');
    // CRITICAL: Clean up and restore state after each test
    const currentDir = process.cwd();
    if (currentDir !== originalCwd) {
      trace(`afterEach: Restoring cwd from ${currentDir} to ${originalCwd}`);
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
          console.error('[test-helper-v2] FATAL: Cannot set working directory in afterEach');
          trace('FATAL: Cannot set working directory in afterEach');
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
    
    // Give a tiny bit of time for any async cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1));
    trace('afterEach hook completed');
  });
}

// Auto-setup hooks when imported
setupTestHooks();

export { resetGlobalState };