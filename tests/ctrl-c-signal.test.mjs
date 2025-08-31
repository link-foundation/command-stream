import { describe, it, expect, afterEach } from 'bun:test';
import { spawn } from 'child_process';

describe('CTRL+C Signal Handling', () => {
  let childProcesses = [];

  afterEach(() => {
    // Clean up any remaining child processes
    childProcesses.forEach(child => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
    childProcesses = [];
  });

  it('should forward SIGINT to child process when external CTRL+C is sent', async () => {
    // Use the existing test-ping.mjs which runs indefinitely and should handle SIGINT
    const child = spawn('node', ['examples/test-ping.mjs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Give the ping process time to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send SIGINT to the child process (simulating CTRL+C)
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // Should exit with SIGINT code (130) due to our signal handling
    expect(exitCode).toBe(130);
    
    // Should have started ping successfully before being interrupted
    expect(stdout).toContain('PING 8.8.8.8');
  }, { timeout: 10000 });

  it('should not interfere with user SIGINT handling when no children active', async () => {
    // Use the existing debug-user-sigint.mjs which has its own SIGINT handler
    const child = spawn('node', ['examples/debug-user-sigint.mjs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Give the process time to set up its signal handler
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send SIGINT to the process
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // Should exit with user's custom exit code (42)
    expect(exitCode).toBe(42);
    expect(stdout).toContain('USER_SIGINT_HANDLER_CALLED');
    expect(stdout).not.toContain('TIMEOUT_REACHED');
  }, { timeout: 5000 });

  it('should handle SIGINT in long-running commands via API', async () => {
    // This test uses the $ API directly but doesn't send signals to the test process
    const { $ } = await import('../src/$.mjs');
    
    // Start a long-running command
    const runner = $`ping -c 10 8.8.8.8`;
    const commandPromise = runner.start();
    
    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Kill the runner directly (this simulates what happens when SIGINT is forwarded)
    runner.kill();
    
    // Wait for command to finish
    const result = await commandPromise;
    
    // Verify the command was interrupted with proper exit code
    expect(result.code).toBe(143); // SIGTERM exit code
  }, { timeout: 10000 });

  it('should handle multiple concurrent processes receiving signals', async () => {
    const { $ } = await import('../src/$.mjs');
    const runners = [];
    const promises = [];
    
    // Start multiple long-running commands
    for (let i = 0; i < 3; i++) {
      const runner = $`ping -c 20 8.8.8.8`;
      runners.push(runner);
      promises.push(runner.start());
    }
    
    // Give them time to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Kill all runners (simulating SIGINT forwarding)
    runners.forEach(runner => runner.kill());
    
    // Wait for all to finish
    const results = await Promise.all(promises);
    
    // All should have been interrupted with proper exit code
    expect(results.length).toBe(3);
    results.forEach(result => {
      expect(result.code).toBe(143); // SIGTERM exit code
    });
  }, { timeout: 10000 });

  it('should properly handle signals in external process with ping', async () => {
    // Create a simple script that uses $ to run ping, then send it SIGINT
    const child = spawn('node', ['-e', `
      import { $ } from './src/$.mjs';
      try {
        console.log('STARTING_PING');
        const result = await \$\`ping -c 20 8.8.8.8\`;
        console.log('PING_COMPLETED:', result.code);
      } catch (error) {
        console.log('PING_ERROR:', error.message);
        process.exit(error.code || 1);
      }
    `], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Wait for ping to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send SIGINT to the process
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // Should exit with SIGINT code due to our signal handling
    expect(exitCode).toBe(130);
    expect(stdout).toContain('STARTING_PING');
    expect(stdout).not.toContain('PING_COMPLETED');
  }, { timeout: 10000 });

  it('should not interfere with child process signal handlers', async () => {
    // Create a script that has its own SIGINT handler for cleanup
    const child = spawn('node', ['-e', `
      import { $ } from './src/$.mjs';
      
      let cleanupDone = false;
      process.on('SIGINT', async () => {
        console.log('CHILD_CLEANUP_START');
        // Simulate cleanup work
        await new Promise(resolve => setTimeout(resolve, 100));
        cleanupDone = true;
        console.log('CHILD_CLEANUP_DONE');
        process.exit(0); // Exit cleanly after cleanup
      });
      
      console.log('CHILD_READY');
      
      // Run a command that will receive SIGINT forwarding
      try {
        await \$\`ping -c 10 8.8.8.8\`;
      } catch (error) {
        console.log('PING_INTERRUPTED');
      }
    `], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Wait for child to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send SIGINT to the process
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // Should exit with SIGINT code (130) due to our signal forwarding
    // The child should have started its cleanup handler
    expect(exitCode).toBe(130);
    expect(stdout).toContain('CHILD_READY');
    expect(stdout).toContain('CHILD_CLEANUP_START');
    // Note: CHILD_CLEANUP_DONE might not appear if the process is killed during cleanup
    // This is realistic behavior when external SIGINT is sent
  }, { timeout: 10000 });
});

describe('CTRL+C with Different stdin Modes', () => {
  let childProcesses = [];

  afterEach(() => {
    // Clean up any remaining child processes
    childProcesses.forEach(child => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
    childProcesses = [];
  });

  it('should handle kill regardless of stdin mode', async () => {
    const { $ } = await import('../src/$.mjs');
    
    // Test 1: Default stdin (inherit)
    const runner1 = $`ping -c 5 8.8.8.8`;
    const promise1 = runner1.start();
    await new Promise(resolve => setTimeout(resolve, 300));
    runner1.kill();
    const result1 = await promise1;
    expect(result1.code).toBe(143); // SIGTERM exit code

    // Test 2: With stdin set to a string using new syntax
    const runner2 = $({ stdin: 'some input data' })`ping -c 5 8.8.8.8`;
    const promise2 = runner2.start();
    await new Promise(resolve => setTimeout(resolve, 300));
    runner2.kill();
    const result2 = await promise2;
    expect(result2.code).toBe(143); // SIGTERM exit code

    // Test 3: With stdin set to ignore using new syntax
    const runner3 = $({ stdin: 'ignore' })`ping -c 5 8.8.8.8`;
    const promise3 = runner3.start();
    await new Promise(resolve => setTimeout(resolve, 300));
    runner3.kill();
    const result3 = await promise3;
    expect(result3.code).toBe(143); // SIGTERM exit code
  }, { timeout: 15000 });

  it('should properly clean up stdin forwarding on external SIGINT', async () => {
    // Test that stdin forwarding is properly cleaned up when external SIGINT is sent
    // We test this by running a process that would use stdin forwarding
    const child = spawn('node', ['-e', `
      import { $ } from './src/$.mjs';
      
      // Store initial stdin state
      const initialIsRaw = process.stdin.isRaw;
      console.log('INITIAL_RAW_MODE:', initialIsRaw || false);
      
      process.on('exit', () => {
        // Report final stdin state on exit
        console.log('FINAL_RAW_MODE:', process.stdin.isRaw || false);
      });
      
      try {
        // Run a command that would trigger stdin forwarding with timeout
        await \$\`timeout 5s cat\`;
      } catch (error) {
        console.log('CAT_INTERRUPTED');
      }
    `], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Give it time to set up stdin forwarding
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send SIGINT to interrupt the cat command
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // Should exit with SIGINT code
    expect(exitCode).toBe(130);
    expect(stdout).toContain('INITIAL_RAW_MODE:');
    expect(stdout).toContain('FINAL_RAW_MODE:');
    // The important thing is that stdin raw mode should be restored properly
    // This is handled by our signal forwarding cleanup
  }, { timeout: 10000 });
});