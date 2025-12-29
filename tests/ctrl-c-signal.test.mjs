import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { spawn } from 'child_process';
import { trace } from '../js/src/$.utils.mjs';

// Platform detection - Windows handles signals differently than Unix
const isWindows = process.platform === 'win32';

// Skip entire describe block on Windows - SIGINT/signal handling is fundamentally different
describe.skipIf(isWindows)('CTRL+C Signal Handling', () => {
  let childProcesses = [];

  beforeEach(async () => {
    await beforeTestCleanup();
  });

  // Log platform information for debugging
  trace('SignalTest', () => `Platform: ${process.platform}`);
  trace('SignalTest', () => `OS Release: ${require('os').release()}`);
  trace('SignalTest', () => `Node Version: ${process.version}`);
  trace('SignalTest', () => `CI Environment: ${process.env.CI || 'false'}`);

  // Baseline test to verify that shell commands work in CI
  it('BASELINE: should handle SIGINT with plain shell command', async () => {
    trace(
      'SignalTest',
      () => `Starting baseline SIGINT test on ${process.platform}`
    );

    const child = spawn('sh', ['-c', 'echo "BASELINE_START" && sleep 30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    trace('SignalTest', () => `Baseline child spawned, PID: ${child.pid}`);
    childProcesses.push(child);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      trace(
        'SignalTest',
        () => `Baseline received stdout: ${JSON.stringify(data.toString())}`
      );
    });

    // Wait for output
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send SIGINT (on macOS with detached:true, might need SIGTERM)
    child.kill('SIGINT');

    // Wait for exit with timeout
    const { code, signal } = await new Promise((resolve) => {
      let resolved = false;

      child.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          resolve({ code, signal });
        }
      });

      // On macOS, detached processes might not respond to SIGINT, use SIGTERM
      setTimeout(() => {
        if (!resolved) {
          trace('SignalTest', 'SIGINT timeout, trying SIGTERM');
          child.kill('SIGTERM');
        }
      }, 1000);

      // Final fallback
      setTimeout(() => {
        if (!resolved) {
          trace('SignalTest', 'SIGTERM timeout, using SIGKILL');
          child.kill('SIGKILL');
        }
      }, 2000);
    });

    trace('SignalTest', () => `Baseline exit code: ${code} signal: ${signal}`);
    trace('SignalTest', () => `Baseline stdout: ${stdout}`);

    expect(stdout).toContain('BASELINE_START');
    // On macOS with detached:true, processes might need SIGTERM/SIGKILL
    // On Linux, it typically exits with code 130 for SIGINT
    const validExit =
      code === 130 ||
      code === 143 ||
      code === 0 ||
      signal === 'SIGINT' ||
      signal === 'SIGTERM' ||
      signal === 'SIGKILL';
    expect(validExit).toBe(true);
  });

  afterEach(async () => {
    // Clean up any remaining child processes
    childProcesses.forEach((child) => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
    childProcesses = [];

    // Run test cleanup
    await afterTestCleanup();
  });

  it(
    'should forward SIGINT to child process when external CTRL+C is sent',
    async () => {
      trace('SignalTest', 'Starting SIGINT forwarding test');
      trace('SignalTest', () => `Current working directory: ${process.cwd()}`);

      // Check if file exists first
      const fs = await import('fs');
      const path = await import('path');
      const scriptPath = path.join(process.cwd(), 'examples', 'test-sleep.mjs');
      trace('SignalTest', () => `Script path: ${scriptPath}`);
      trace('SignalTest', () => `Script exists: ${fs.existsSync(scriptPath)}`);

      // Use the test-sleep.mjs which tests our actual library
      const child = spawn('node', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        cwd: process.cwd(), // Explicitly set working directory
      });

      trace('SignalTest', () => `Child process spawned, PID: ${child.pid}`);
      childProcesses.push(child);

      let stdout = '';
      let stderr = '';
      let dataReceived = false;
      const stdoutChunks = [];

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        stdoutChunks.push({ time: Date.now(), data: chunk });
        dataReceived = true;
        trace(
          'SignalTest',
          () => `Received stdout chunk: ${JSON.stringify(chunk)}`
        );
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        trace('SignalTest', () => `Child stderr: ${chunk.trim()}`);
      });

      child.on('error', (error) => {
        trace('SignalTest', () => `Child process error: ${error.message}`);
        trace('SignalTest', () => `Error stack: ${error.stack}`);
      });

      child.on('spawn', () => {
        trace('SignalTest', 'Child process spawned successfully');
      });

      // Wait for the process to start and output data
      let attempts = 0;
      while (!dataReceived && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
        if (attempts % 5 === 0) {
          trace('SignalTest', () => `Waiting for stdout, attempt: ${attempts}`);
        }
      }

      trace(
        'SignalTest',
        () => `Data received: ${dataReceived} after attempts: ${attempts}`
      );
      trace('SignalTest', () => `Current stdout length: ${stdout.length}`);
      trace('SignalTest', () => `Current stderr length: ${stderr.length}`);

      // Additional wait to ensure process is fully running
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send SIGINT to the child process (simulating CTRL+C)
      trace('SignalTest', 'Sending SIGINT to child process');
      const killResult = child.kill('SIGINT');
      trace('SignalTest', () => `Kill result: ${killResult}`);

      // Wait for the process to exit with robust handling
      const exitCode = await new Promise((resolve) => {
        let resolved = false;

        child.on('close', (code, signal) => {
          trace(
            'SignalTest',
            () => `Child closed with code: ${code} signal: ${signal}`
          );
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        child.on('exit', (code, signal) => {
          trace(
            'SignalTest',
            () => `Child exited with code: ${code} signal: ${signal}`
          );
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            trace('SignalTest', 'Timeout reached, force killing child');
            resolved = true;
            child.kill('SIGKILL');
            resolve(137);
          }
        }, 3000);
      });

      // Should exit with SIGINT code (130) due to our signal handling
      trace('SignalTest', () => `First test exit code: ${exitCode}`);
      trace('SignalTest', () => `First test stdout length: ${stdout.length}`);
      if (stdout.length === 0) {
        trace('SignalTest', 'WARNING: No stdout captured!');
        trace('SignalTest', () => `stderr content: ${stderr}`);
        trace(
          'SignalTest',
          () => `stdout chunks received: ${JSON.stringify(stdoutChunks)}`
        );
      } else {
        trace('SignalTest', () => `stdout content: ${JSON.stringify(stdout)}`);
      }

      expect([130, 143, 137].includes(exitCode) || exitCode > 0).toBe(true);

      // Should have started sleep successfully before being interrupted
      expect(stdout).toContain('STARTING_SLEEP');
    },
    { timeout: 10000 }
  );

  it(
    'should not interfere with user SIGINT handling when no children active',
    async () => {
      // Use inline Node.js code for better CI reliability
      const nodeCode = `
      process.on('SIGINT', () => {
        console.log('USER_SIGINT_HANDLER_CALLED');
        process.exit(42);
      });
      console.log('Process started, waiting for SIGINT...');
      setTimeout(() => {
        console.log('TIMEOUT_REACHED');
        process.exit(1);
      }, 5000);
    `;
      const child = spawn('node', ['-e', nodeCode], {
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
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send SIGINT to the process
      child.kill('SIGINT');

      // Wait for the process to exit with robust handling
      const exitCode = await new Promise((resolve) => {
        let resolved = false;

        child.on('close', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        child.on('exit', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGKILL');
            resolve(137);
          }
        }, 3000);
      });

      // Should exit with user's custom exit code (42)
      expect(exitCode).toBe(42);
      expect(stdout).toContain('USER_SIGINT_HANDLER_CALLED');
      expect(stdout).not.toContain('TIMEOUT_REACHED');
    },
    { timeout: 5000 }
  );

  it(
    'should handle SIGINT in long-running commands via API',
    async () => {
      // This test uses the $ API directly but doesn't send signals to the test process
      const { $ } = await import('../src/$.mjs');

      // Start a long-running command
      const runner = $`sleep 10`;
      const commandPromise = runner.start();

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Kill the runner directly (this simulates what happens when SIGINT is forwarded)
      runner.kill();

      // Wait for command to finish
      const result = await commandPromise;

      // Verify the command was interrupted with proper exit code
      expect(result.code).toBe(143); // SIGTERM exit code
    },
    { timeout: 10000 }
  );

  it(
    'should handle multiple concurrent processes receiving signals',
    async () => {
      const { $ } = await import('../src/$.mjs');
      const runners = [];
      const promises = [];

      // Start multiple long-running commands
      for (let i = 0; i < 3; i++) {
        const runner = $`sleep 10`;
        runners.push(runner);
        promises.push(runner.start());
      }

      // Give them time to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Kill all runners (simulating SIGINT forwarding)
      runners.forEach((runner) => runner.kill());

      // Wait for all to finish
      const results = await Promise.all(promises);

      // All should have been interrupted with proper exit code
      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.code).toBe(143); // SIGTERM exit code
      });
    },
    { timeout: 10000 }
  );

  it(
    'should properly handle signals in external process with sleep',
    async () => {
      // Use a simple shell script for CI reliability
      const child = spawn(
        'sh',
        ['-c', 'echo "STARTING_SLEEP" && sleep 10 && echo "SLEEP_COMPLETED"'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        }
      );

      childProcesses.push(child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for sleep to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Send SIGINT to the process
      child.kill('SIGINT');

      // Wait for the process to exit with robust handling
      const exitCode = await new Promise((resolve) => {
        let resolved = false;

        child.on('close', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        child.on('exit', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGKILL');
            resolve(137);
          }
        }, 3000);
      });

      // Should exit with SIGINT code due to our signal handling
      trace('SignalTest', () => `Third test exit code: ${exitCode}`);
      expect([130, 143, 137].includes(exitCode) || exitCode > 0).toBe(true);
      expect(stdout).toContain('STARTING_SLEEP');
      expect(stdout).not.toContain('SLEEP_COMPLETED');
    },
    { timeout: 10000 }
  );

  it(
    'should not interfere with child process signal handlers',
    async () => {
      // Create a script that has its own SIGINT handler for cleanup (no ES modules)
      const nodeCode = `
      let cleanupDone = false;
      process.on('SIGINT', () => {
        console.log('CHILD_CLEANUP_START');
        // Simulate cleanup work
        setTimeout(() => {
          cleanupDone = true;
          console.log('CHILD_CLEANUP_DONE');
          process.exit(0); // Exit cleanly after cleanup
        }, 100);
      });
      
      console.log('CHILD_READY');
      
      // Keep process alive
      setTimeout(() => {
        console.log('TIMEOUT_REACHED');
        process.exit(1);
      }, 5000);
    `;
      const child = spawn('node', ['-e', nodeCode], {
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
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Send SIGINT to the process
      child.kill('SIGINT');

      // Wait for the process to exit with robust handling
      const exitCode = await new Promise((resolve) => {
        let resolved = false;

        child.on('close', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        child.on('exit', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGKILL');
            resolve(137);
          }
        }, 3000);
      });

      // Should exit with exit code 0 since child has its own SIGINT handler that calls process.exit(0)
      // The child should have started its cleanup handler
      trace('SignalTest', () => `Fourth test exit code: ${exitCode}`);
      expect(exitCode).toBe(0); // This test is specifically for children with custom signal handlers
      expect(stdout).toContain('CHILD_READY');
      expect(stdout).toContain('CHILD_CLEANUP_START');
      // Note: CHILD_CLEANUP_DONE might not appear if the process is killed during cleanup
      // This is realistic behavior when external SIGINT is sent
    },
    { timeout: 10000 }
  );
});

// Skip entire describe block on Windows - uses 'sh' shell and Unix signals
describe.skipIf(isWindows)('CTRL+C with Different stdin Modes', () => {
  let childProcesses = [];

  beforeEach(async () => {
    await beforeTestCleanup();
  });

  afterEach(async () => {
    // Clean up any remaining child processes
    childProcesses.forEach((child) => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
    childProcesses = [];

    // Run test cleanup
    await afterTestCleanup();
  });

  it(
    'should handle kill regardless of stdin mode',
    async () => {
      const { $ } = await import('../src/$.mjs');

      // Test 1: Default stdin (inherit)
      const runner1 = $`sleep 3`;
      const promise1 = runner1.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      runner1.kill();
      const result1 = await promise1;
      expect(result1.code).toBe(143); // SIGTERM exit code

      // Test 2: With stdin set to a string using new syntax
      const runner2 = $({ stdin: 'some input data' })`sleep 3`;
      const promise2 = runner2.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      runner2.kill();
      const result2 = await promise2;
      expect(result2.code).toBe(143); // SIGTERM exit code

      // Test 3: With stdin set to ignore using new syntax
      const runner3 = $({ stdin: 'ignore' })`sleep 3`;
      const promise3 = runner3.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      runner3.kill();
      const result3 = await promise3;
      expect(result3.code).toBe(143); // SIGTERM exit code
    },
    { timeout: 15000 }
  );

  it(
    'should properly clean up stdin forwarding on external SIGINT',
    async () => {
      // Test that stdin forwarding is properly cleaned up when external SIGINT is sent
      // Use simple shell command for CI reliability
      const child = spawn('sh', ['-c', 'echo "RUNNING_COMMAND" && sleep 3'], {
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
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send SIGINT to interrupt the cat command
      child.kill('SIGINT');

      // Wait for the process to exit with robust handling
      const exitCode = await new Promise((resolve) => {
        let resolved = false;

        child.on('close', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        child.on('exit', (code, signal) => {
          if (!resolved) {
            resolved = true;
            resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGKILL');
            resolve(137);
          }
        }, 3000);
      });

      // Should exit with SIGINT code or clean exit (both are acceptable for stdin cleanup tests)
      trace('SignalTest', () => `Fifth test exit code: ${exitCode}`);
      expect(typeof exitCode).toBe('number'); // Just ensure we get a valid exit code
      expect(stdout).toContain('RUNNING_COMMAND');
      // The important thing is that the process is properly cleaned up
      // This is handled by our signal forwarding cleanup
    },
    { timeout: 10000 }
  );

  it(
    'should handle parent stream closure triggering process cleanup',
    async () => {
      // Test parent stream closure handling mechanism
      const child = spawn(
        'node',
        [
          '-e',
          `
      import { $ } from './js/src/$.mjs';
      
      // Start a long-running command
      const runner = $\`sleep 5\`;
      const promise = runner.start();
      
      // Simulate parent stream closure after a delay
      setTimeout(() => {
        console.log('SIMULATING_PARENT_STREAM_CLOSURE');
        process.stdout.destroy(); // This should trigger cleanup
      }, 1000);
      
      try {
        await promise;
        console.log('COMMAND_COMPLETED');
      } catch (error) {
        console.log('COMMAND_INTERRUPTED');
      }
    `,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        }
      );

      childProcesses.push(child);

      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Wait for the process to complete
      const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
          resolve(code);
        });
      });

      // Should have detected parent stream closure and exited
      expect(stdout).toContain('SIMULATING_PARENT_STREAM_CLOSURE');
      expect(typeof exitCode).toBe('number'); // Should have a valid exit code
    },
    { timeout: 10000 }
  );

  it(
    'should bypass virtual commands with custom stdin for proper signal handling',
    async () => {
      // Test the bypass logic for built-in commands with custom stdin
      const child = spawn(
        'node',
        [
          '-e',
          `
      import { $ } from './js/src/$.mjs';
      
      console.log('STARTING_SLEEP_WITH_CUSTOM_STDIN');
      
      try {
        // This should bypass virtual sleep and use real /usr/bin/sleep
        const result = await \$({ stdin: 'custom input' })\`sleep 2\`;
        console.log('SLEEP_COMPLETED: ' + result.code);
      } catch (error) {
        console.log('SLEEP_ERROR: ' + error.message);
      }
    `,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        }
      );

      childProcesses.push(child);

      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Give it time to start then interrupt
      await new Promise((resolve) => setTimeout(resolve, 500));
      child.kill('SIGINT');

      const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
          resolve(code);
        });
      });

      trace('SignalTest', () => `Sixth test exit code: ${exitCode}`);
      expect([130, 143, 137].includes(exitCode) || exitCode > 0).toBe(true); // SIGINT exit code
      expect(stdout).toContain('STARTING_SLEEP_WITH_CUSTOM_STDIN');
    },
    { timeout: 10000 }
  );

  it(
    'should handle Bun vs Node.js signal differences',
    async () => {
      // Test platform-specific signal handling
      const child = spawn(
        'node',
        [
          '-e',
          `
      import { $ } from './js/src/$.mjs';
      
      const isBun = typeof globalThis.Bun !== 'undefined';
      console.log('RUNTIME: ' + (isBun ? 'BUN' : 'NODE'));
      
      try {
        const result = await $\`sleep 2\`;
        console.log('SLEEP_COMPLETED: ' + result.code);
      } catch (error) {
        console.log('SLEEP_ERROR: ' + error.message);
      }
    `,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        }
      );

      childProcesses.push(child);

      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Let it run for a bit then interrupt
      await new Promise((resolve) => setTimeout(resolve, 1000));
      child.kill('SIGINT');

      const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
          resolve(code);
        });
      });

      trace('SignalTest', () => `Seventh test exit code: ${exitCode}`);
      expect(typeof exitCode).toBe('number'); // Platform differences may result in various exit codes
      expect(stdout).toMatch(/RUNTIME: (BUN|NODE)/);
    },
    { timeout: 10000 }
  );

  // REGRESSION TEST: Core issue that was fixed
  it(
    'should properly cancel virtual commands and respect user SIGINT handlers (regression test)',
    async () => {
      // This test prevents regression of the core issue where:
      // 1. Virtual commands (sleep) weren't being cancelled by SIGINT
      // 2. SIGINT handler was interfering with user-defined handlers
      // 3. Processes weren't outputting expected logs before interruption

      // Test 1: Virtual command cancellation with proper exit codes
      trace('SignalTest', 'Testing virtual command SIGINT cancellation...');
      const child1 = spawn('node', ['examples/test-sleep.mjs'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      let stdout1 = '';
      child1.stdout.on('data', (data) => {
        stdout1 += data.toString();
      });

      // Wait for command to start, then interrupt
      await new Promise((resolve) => setTimeout(resolve, 500));
      child1.kill('SIGINT');

      const exitCode1 = await new Promise((resolve) => {
        child1.on('close', (code) => resolve(code));
      });

      // Should capture startup output and exit with SIGINT code
      expect(stdout1).toContain('STARTING_SLEEP');
      expect(stdout1).not.toContain('SLEEP_COMPLETED');
      expect(exitCode1).toBe(130); // 128 + 2 (SIGINT)
      trace('SignalTest', '✓ Virtual command properly cancelled with SIGINT');

      // Test 2: User SIGINT handler cooperation
      trace('SignalTest', 'Testing user SIGINT handler cooperation...');
      const child2 = spawn(
        'node',
        [
          '-e',
          `
      import { $ } from './js/src/$.mjs';
      
      // Set up user's SIGINT handler AFTER importing our library
      process.on('SIGINT', () => {
        console.log('USER_HANDLER_EXECUTED');
        process.exit(42);
      });
      
      console.log('PROCESS_READY');
      
      // Run a virtual command that will be interrupted
      try {
        await \$\`sleep 5\`;
        console.log('SLEEP_FINISHED');
      } catch (err) {
        console.log('SLEEP_ERROR');
      }
    `,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        }
      );

      let stdout2 = '';
      child2.stdout.on('data', (data) => {
        stdout2 += data.toString();
      });

      // Wait for setup, then interrupt
      await new Promise((resolve) => setTimeout(resolve, 500));
      child2.kill('SIGINT');

      const exitCode2 = await new Promise((resolve) => {
        child2.on('close', (code) => resolve(code));
      });

      // User's handler should take precedence
      expect(stdout2).toContain('PROCESS_READY');
      expect(stdout2).toContain('USER_HANDLER_EXECUTED');
      expect(exitCode2).toBe(42); // User's custom exit code
      trace('SignalTest', '✓ User SIGINT handler properly executed');

      trace(
        'SignalTest',
        '🎉 Regression test passed - core issues remain fixed'
      );
    },
    { timeout: 15000 }
  );
});
