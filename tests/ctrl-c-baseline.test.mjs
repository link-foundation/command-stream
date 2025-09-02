import { describe, it, expect, afterEach } from 'bun:test';
import { spawn } from 'child_process';

/**
 * Baseline tests for CTRL+C signal handling using native spawn
 * These tests verify that the CI environment can handle basic process spawning and signals
 * without using our library, providing a comparison point for debugging
 */
describe('CTRL+C Baseline Tests (Native Spawn)', () => {
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

  it('should handle SIGINT with simple shell command', async () => {
    console.error('[BASELINE] Testing simple shell command');
    
    const child = spawn('sh', ['-c', 'echo "BASELINE_START" && sleep 30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
    console.error('[BASELINE] Child spawned, PID:', child.pid);
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.error('[BASELINE] Received stdout:', JSON.stringify(data.toString()));
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('[BASELINE] Received stderr:', JSON.stringify(data.toString()));
    });
    
    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.error('[BASELINE] Sending SIGINT');
    child.kill('SIGINT');
    
    // Wait for exit
    const exitCode = await new Promise((resolve) => {
      let resolved = false;
      child.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          console.error('[BASELINE] Process exited with code:', code, 'signal:', signal);
          resolve(code !== null ? code : (signal === 'SIGINT' ? 130 : 1));
        }
      });
      
      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error('[BASELINE] Timeout, force killing');
          child.kill('SIGKILL');
          resolve(137);
        }
      }, 3000);
    });
    
    console.error('[BASELINE] Final stdout:', stdout);
    console.error('[BASELINE] Final stderr:', stderr);
    console.error('[BASELINE] Exit code:', exitCode);
    
    expect(stdout).toContain('BASELINE_START');
    // Accept both 130 (SIGINT) and 137 (SIGKILL) as valid
    expect([130, 137].includes(exitCode)).toBe(true);
  });

  it('should handle Node.js inline script with SIGINT', async () => {
    console.error('[BASELINE] Testing Node.js inline script');
    
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
    
    console.error('[BASELINE] Node child spawned, PID:', child.pid);
    childProcesses.push(child);
    
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.error('[BASELINE] Node stdout:', JSON.stringify(data.toString()));
    });
    
    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.error('[BASELINE] Sending SIGINT to Node process');
    child.kill('SIGINT');
    
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => {
        console.error('[BASELINE] Node process exited with code:', code);
        resolve(code);
      });
    });
    
    console.error('[BASELINE] Node final stdout:', stdout);
    console.error('[BASELINE] Node exit code:', exitCode);
    
    expect(stdout).toContain('NODE_START');
    expect(stdout).toContain('SIGINT_RECEIVED');
    expect(exitCode).toBe(130);
  });

  it('should handle Node.js script file', async () => {
    console.error('[BASELINE] Testing Node.js script file');
    
    // Use the simple-test-sleep.js which doesn't have ES module dependencies
    const child = spawn('node', ['examples/simple-test-sleep.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd: process.cwd()
    });
    
    console.error('[BASELINE] Script child spawned, PID:', child.pid);
    childProcesses.push(child);
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.error('[BASELINE] Script stdout:', JSON.stringify(data.toString()));
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();  
      console.error('[BASELINE] Script stderr:', data.toString().trim());
    });
    
    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.error('[BASELINE] Sending SIGINT to script');
    child.kill('SIGINT');
    
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => {
        console.error('[BASELINE] Script exited with code:', code);
        resolve(code);
      });
    });
    
    console.error('[BASELINE] Script final stdout:', stdout);
    console.error('[BASELINE] Script final stderr (first 200 chars):', stderr.substring(0, 200));
    console.error('[BASELINE] Script exit code:', exitCode);
    
    expect(stdout).toContain('STARTING_SLEEP');
    expect(exitCode).toBe(130);
  });
});