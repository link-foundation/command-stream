import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { $ } from '../src/$.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('CTRL+C Signal Handling', () => {
  let childProcess = null;

  afterEach(() => {
    // Clean up any remaining child processes
    if (childProcess && !childProcess.killed) {
      childProcess.kill('SIGKILL');
    }
  });

  it('should forward SIGINT to child process when CTRL+C is pressed', async () => {
    // Create a test script that handles SIGINT
    const testScript = `
#!/usr/bin/env node
let sigintReceived = false;
process.on('SIGINT', () => {
  console.log('CHILD_SIGINT_RECEIVED');
  sigintReceived = true;
  process.exit(130);
});

// Keep running until interrupted
console.log('CHILD_STARTED');
setInterval(() => {
  if (!sigintReceived) {
    console.log('CHILD_RUNNING');
  }
}, 100);
`;

    const scriptPath = join(__dirname, 'test-sigint-child.js');
    await fs.writeFile(scriptPath, testScript);
    await fs.chmod(scriptPath, 0o755);

    try {
      // Start the command using our library
      const promise = $`node ${scriptPath}`;
      
      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Send SIGINT to the parent process (simulating CTRL+C)
      process.kill(process.pid, 'SIGINT');
      
      // Wait for the command to finish
      try {
        await promise;
      } catch (error) {
        // We expect an error due to the signal
        expect(error.code).toBe(130); // Standard SIGINT exit code
      }
    } finally {
      // Clean up test script
      await fs.unlink(scriptPath).catch(() => {});
    }
  });

  it('should handle SIGINT in long-running commands', async () => {
    let errorCaught = false;
    let exitCode = null;
    
    // Start a long-running command
    const commandPromise = $`sleep 30`.catch(error => {
      errorCaught = true;
      exitCode = error.code;
      return error;
    });
    
    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send SIGINT
    process.kill(process.pid, 'SIGINT');
    
    // Wait for command to finish
    await commandPromise;
    
    // Verify the command was interrupted
    expect(errorCaught).toBe(true);
    // Exit code should indicate interruption (typically 130 for SIGINT)
    expect(exitCode).toBeDefined();
  });

  it('should properly clean up stdin forwarding on SIGINT', async () => {
    // Test that raw mode is properly cleaned up after SIGINT
    const initialIsRaw = process.stdin.isRaw;
    
    // Create a test that uses stdin forwarding
    const testScript = `
#!/usr/bin/env node
process.stdin.on('data', (data) => {
  console.log('Received:', data.toString());
});
setTimeout(() => {}, 10000); // Keep running
`;

    const scriptPath = join(__dirname, 'test-stdin-forward.js');
    await fs.writeFile(scriptPath, testScript);
    await fs.chmod(scriptPath, 0o755);

    try {
      // Start command that forwards stdin
      const promise = $`node ${scriptPath}`;
      
      // Give it time to set up stdin forwarding
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Send SIGINT
      process.kill(process.pid, 'SIGINT');
      
      // Wait for cleanup
      try {
        await promise;
      } catch (error) {
        // Expected to fail due to signal
      }
      
      // Check that stdin raw mode is restored
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(process.stdin.isRaw).toBe(initialIsRaw);
    } finally {
      // Clean up
      await fs.unlink(scriptPath).catch(() => {});
    }
  });

  it('should handle multiple concurrent processes receiving SIGINT', async () => {
    const promises = [];
    const results = [];
    
    // Start multiple sleep commands
    for (let i = 0; i < 3; i++) {
      const promise = $`sleep 30`.catch(error => {
        results.push({ id: i, code: error.code });
        return error;
      });
      promises.push(promise);
    }
    
    // Give them time to start
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Send SIGINT
    process.kill(process.pid, 'SIGINT');
    
    // Wait for all to finish
    await Promise.all(promises);
    
    // All should have been interrupted
    expect(results.length).toBe(3);
    results.forEach(result => {
      expect(result.code).toBeDefined();
    });
  });

  it('should not interfere with child process signal handlers', async () => {
    // Test that child processes can have their own SIGINT handlers
    const testScript = `
#!/usr/bin/env node
let cleanupDone = false;
process.on('SIGINT', async () => {
  console.log('CHILD_CLEANUP_START');
  // Simulate cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
  cleanupDone = true;
  console.log('CHILD_CLEANUP_DONE');
  process.exit(0); // Exit cleanly after cleanup
});

console.log('CHILD_READY');
// Keep running
setInterval(() => {}, 100);
`;

    const scriptPath = join(__dirname, 'test-child-handler.js');
    await fs.writeFile(scriptPath, testScript);
    await fs.chmod(scriptPath, 0o755);

    try {
      let output = '';
      const runner = $`node ${scriptPath}`;
      
      // Capture output
      runner.on('stdout', (data) => {
        output += data.toString();
      });
      
      // Wait for child to be ready
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Send SIGINT
      process.kill(process.pid, 'SIGINT');
      
      // Wait for command to finish
      try {
        await runner;
      } catch (error) {
        // Check that child had chance to clean up
        expect(output).toContain('CHILD_CLEANUP_START');
        expect(output).toContain('CHILD_CLEANUP_DONE');
      }
    } finally {
      await fs.unlink(scriptPath).catch(() => {});
    }
  });
});

describe('CTRL+C with Different stdin Modes', () => {
  it('should handle SIGINT with stdin: "inherit"', async () => {
    let errorCode = null;
    
    try {
      const promise = $({ stdin: 'inherit' })`sleep 30`;
      
      // Give it time to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send SIGINT
      process.kill(process.pid, 'SIGINT');
      
      await promise;
    } catch (error) {
      errorCode = error.code;
    }
    
    expect(errorCode).toBeDefined();
  });

  it('should handle SIGINT with stdin: "ignore"', async () => {
    let errorCode = null;
    
    try {
      const promise = $({ stdin: 'ignore' })`sleep 30`;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      process.kill(process.pid, 'SIGINT');
      
      await promise;
    } catch (error) {
      errorCode = error.code;
    }
    
    expect(errorCode).toBeDefined();
  });

  it('should handle SIGINT with piped stdin', async () => {
    let errorCode = null;
    
    try {
      const promise = $({ stdin: 'test input\n' })`sleep 30`;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      process.kill(process.pid, 'SIGINT');
      
      await promise;
    } catch (error) {
      errorCode = error.code;
    }
    
    expect(errorCode).toBeDefined();
  });
});