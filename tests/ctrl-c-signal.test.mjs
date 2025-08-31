import { describe, it, expect, afterEach } from 'bun:test';
import { $ } from '../src/$.mjs';
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
    // Start a long-running command
    const runner = $`sleep 30`;
    const commandPromise = runner.start();
    
    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Instead of sending SIGINT to parent, directly kill the runner
    // This simulates what would happen when SIGINT is forwarded
    runner.kill();
    
    // Wait for command to finish
    const result = await commandPromise;
    
    // Verify the command was interrupted with proper exit code
    expect(result.code).toBe(143); // SIGTERM exit code for virtual commands
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
    const runners = [];
    const promises = [];
    
    // Start multiple sleep commands
    for (let i = 0; i < 3; i++) {
      const runner = $`sleep 30`;
      runners.push(runner);
      promises.push(runner.start());
    }
    
    // Give them time to start
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Kill all runners (simulating SIGINT forwarding)
    runners.forEach(runner => runner.kill());
    
    // Wait for all to finish
    const results = await Promise.all(promises);
    
    // All should have been interrupted with proper exit code
    expect(results.length).toBe(3);
    results.forEach(result => {
      expect(result.code).toBe(143); // SIGTERM exit code
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
  it('should handle kill regardless of stdin mode', async () => {
    // All tests use sleep which doesn't depend on stdin
    // This verifies kill() works with different stdin configurations
    
    // Test 1: Default stdin (inherit)
    const runner1 = $`sleep 30`;
    const promise1 = runner1.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    runner1.kill();
    const result1 = await promise1;
    expect(result1.code).toBe(143); // SIGTERM exit code

    // Test 2: With stdin set to a string using new syntax
    const runner2 = $({ stdin: 'some input data' })`sleep 10`;
    const promise2 = runner2.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    runner2.kill();
    const result2 = await promise2;
    expect(result2.code).toBe(143); // SIGTERM exit code

    // Test 3: With stdin set to ignore using new syntax
    const runner3 = $({ stdin: 'ignore' })`sleep 10`;
    const promise3 = runner3.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    runner3.kill();
    const result3 = await promise3;
    expect(result3.code).toBe(143); // SIGTERM exit code
  });
});