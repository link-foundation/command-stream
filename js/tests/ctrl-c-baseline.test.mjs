import { describe, it, expect, afterEach } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { spawn } from 'child_process';
import { trace } from '../src/$.utils.mjs';

// Platform detection - Windows handles signals differently than Unix
const isWindows = process.platform === 'win32';

/**
 * Baseline tests for CTRL+C signal handling using native spawn
 * These tests verify that the CI environment can handle basic process spawning and signals
 * without using our library, providing a comparison point for debugging
 *
 * Note: These tests are skipped on Windows because:
 * 1. Windows doesn't have 'sh' shell by default
 * 2. SIGINT/signal handling works fundamentally different on Windows
 * 3. Exit codes 130 (128+SIGINT) are Unix-specific
 */
describe.skipIf(isWindows)('CTRL+C Baseline Tests (Native Spawn)', () => {
  let childProcesses = [];

  afterEach(() => {
    // Clean up any remaining child processes
    childProcesses.forEach((child) => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    });
    childProcesses = [];
  });

  it('should handle SIGINT with simple shell command', async () => {
    trace('BaselineTest', 'Testing simple shell command');

    const child = spawn('sh', ['-c', 'echo "BASELINE_START" && sleep 30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    trace('BaselineTest', () => `Child spawned, PID: ${child.pid}`);
    childProcesses.push(child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      trace(
        'BaselineTest',
        () => `Received stdout: ${JSON.stringify(data.toString())}`
      );
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      trace(
        'BaselineTest',
        () => `Received stderr: ${JSON.stringify(data.toString())}`
      );
    });

    // Wait for output
    await new Promise((resolve) => setTimeout(resolve, 500));

    trace('BaselineTest', 'Sending SIGINT');
    child.kill('SIGINT');

    // Wait for exit
    const exitCode = await new Promise((resolve) => {
      let resolved = false;
      child.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          trace(
            'BaselineTest',
            () => `Process exited with code: ${code} signal: ${signal}`
          );
          resolve(code !== null ? code : signal === 'SIGINT' ? 130 : 1);
        }
      });

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          trace('BaselineTest', 'Timeout, force killing');
          child.kill('SIGKILL');
          resolve(137);
        }
      }, 3000);
    });

    trace('BaselineTest', () => `Final stdout: ${stdout}`);
    trace('BaselineTest', () => `Final stderr: ${stderr}`);
    trace('BaselineTest', () => `Exit code: ${exitCode}`);

    expect(stdout).toContain('BASELINE_START');
    // Accept both 130 (SIGINT) and 137 (SIGKILL) as valid
    expect([130, 137].includes(exitCode)).toBe(true);
  });

  it('should handle Node.js inline script with SIGINT', async () => {
    trace('BaselineTest', 'Testing Node.js inline script');

    const nodeCode = `
      console.log('NODE_START');
      process.on('SIGINT', () => {
        console.log('SIGINT_RECEIVED');
        process.exit(130);
      });
      setTimeout(() => {
        console.log('TIMEOUT');
        process.exit(1);
      }, 30000);
    `;

    const child = spawn('node', ['-e', nodeCode], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    trace('BaselineTest', () => `Node child spawned, PID: ${child.pid}`);
    childProcesses.push(child);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      trace(
        'BaselineTest',
        () => `Node stdout: ${JSON.stringify(data.toString())}`
      );
    });

    // Wait for startup
    await new Promise((resolve) => setTimeout(resolve, 500));

    trace('BaselineTest', 'Sending SIGINT to Node process');
    child.kill('SIGINT');

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => {
        trace('BaselineTest', () => `Node process exited with code: ${code}`);
        resolve(code);
      });
    });

    trace('BaselineTest', () => `Node final stdout: ${stdout}`);
    trace('BaselineTest', () => `Node exit code: ${exitCode}`);

    expect(stdout).toContain('NODE_START');
    expect(stdout).toContain('SIGINT_RECEIVED');
    expect(exitCode).toBe(130);
  });

  it('should handle Node.js script file', async () => {
    trace('BaselineTest', 'Testing Node.js script file');

    // Use the simple-test-sleep.js which doesn't have ES module dependencies
    const child = spawn('node', ['js/examples/simple-test-sleep.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd: process.cwd(),
    });

    trace('BaselineTest', () => `Script child spawned, PID: ${child.pid}`);
    childProcesses.push(child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      trace(
        'BaselineTest',
        () => `Script stdout: ${JSON.stringify(data.toString())}`
      );
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      trace('BaselineTest', () => `Script stderr: ${data.toString().trim()}`);
    });

    // Wait for startup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    trace('BaselineTest', 'Sending SIGINT to script');
    child.kill('SIGINT');

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => {
        trace('BaselineTest', () => `Script exited with code: ${code}`);
        resolve(code);
      });
    });

    trace('BaselineTest', () => `Script final stdout: ${stdout}`);
    trace(
      'BaselineTest',
      () => `Script final stderr (first 200 chars): ${stderr.substring(0, 200)}`
    );
    trace('BaselineTest', () => `Script exit code: ${exitCode}`);

    expect(stdout).toContain('STARTING_SLEEP');
    expect(exitCode).toBe(130);
  });
});
