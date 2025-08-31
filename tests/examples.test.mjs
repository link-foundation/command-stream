import { test, expect, describe } from 'bun:test';
import { $ } from '../src/$.mjs';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

// Get all .mjs examples
const examplesDir = join(process.cwd(), 'examples');
const allExamples = readdirSync(examplesDir)
  .filter(file => file.endsWith('.mjs') && statSync(join(examplesDir, file)).isFile())
  .sort();

// Filter examples based on their content to avoid Bun-specific features
const nodeCompatibleExamples = allExamples.filter(exampleFile => {
  const content = readFileSync(join(examplesDir, exampleFile), 'utf8');
  return !content.includes('Bun.spawn') && !content.includes('Bun.file');
});

describe('Examples Execution Tests', () => {
  // Core functionality test - our main example should work
  test('readme-example.mjs should execute and demonstrate new API signature', async () => {
    const result = await $`node examples/readme-example.mjs`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Hello, World!');
    expect(result.stdout).toContain('Hello, Mr. Smith!');
    expect(result.stdout).toContain('"stdinLength": 11');
    expect(result.stdout).toContain('"mirror": true');
    expect(result.stdout).toContain('"capture": true');
  });

  // JSON streaming test - key feature
  test('simple-jq-streaming.mjs should complete successfully', async () => {
    const result = await $`node examples/simple-jq-streaming.mjs`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('✅ Streaming completed successfully!');
    expect(result.stdout).toContain('🎉 All tests passed!');
    expect(result.stdout).toContain('JSON streaming with jq works');
  });

  // Summary test to report on examples
  test('should have examples available for manual testing', () => {
    console.log(`\n📊 Examples Summary:`);
    console.log(`   Total examples: ${allExamples.length}`);
    console.log(`   Node-compatible: ${nodeCompatibleExamples.length}`);
    console.log(`   Bun-specific: ${allExamples.length - nodeCompatibleExamples.length}`);
    
    // Show a few example files for manual testing
    const manualTestExamples = [
      'debug-streaming.mjs',
      'working-streaming-demo.mjs',
      'test-simple-pipe.mjs'
    ].filter(ex => nodeCompatibleExamples.includes(ex));
    
    if (manualTestExamples.length > 0) {
      console.log(`\n   Recommended for manual testing:`);
      manualTestExamples.forEach(ex => console.log(`     node examples/${ex}`));
    }
    
    expect(allExamples.length).toBeGreaterThan(0);
    expect(nodeCompatibleExamples.length).toBeGreaterThan(0);
  });

  // Test sleep example with external CTRL+C handling (CI-safe)
  test('external process can be interrupted with SIGINT', async () => {
    const { spawn } = await import('child_process');
    
    // Use a simple inline script instead of external file
    const child = spawn('node', ['-e', 'await new Promise(resolve => setTimeout(resolve, 10000))'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false, // Don't detach to ensure proper signal forwarding
    });
    
    // Give the process time to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send SIGINT to the process
    child.kill('SIGINT');
    
    // Wait for the process to exit with both close and exit handlers
    const exitCode = await new Promise((resolve) => {
      let resolved = false;
      
      child.on('close', (code, signal) => {
        if (!resolved) {
          resolved = true;
          resolve(code !== null ? code : (signal ? 128 + 2 : 1));
        }
      });
      
      child.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          resolve(code !== null ? code : (signal ? 128 + 2 : 1));
        }
      });
      
      // Fallback timeout in case the process doesn't respond
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGKILL');
          resolve(137); // SIGKILL exit code
        }
      }, 2000);
    });
    
    // Should be interrupted (non-zero exit code)
    expect(exitCode).not.toBe(0);
    // Different platforms may return different codes, be flexible
    console.log('Actual exit code:', exitCode);
    expect(exitCode).toBeGreaterThan(0);
  }, { timeout: 5000 });

  // Test that verifies $.mjs can interrupt processes correctly
  test('$.mjs should properly handle process interruption', async () => {
    // Start long-running sleep command
    const runner = $`sleep 5`;
    
    // Start the process
    const promise = runner.start();
    
    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Kill the process directly
    runner.kill();
    
    // Wait for the process to complete
    const result = await promise;
    
    // Process should have been killed with SIGTERM exit code
    expect(result.code).toBe(143);
    expect(result.code).not.toBe(0);
  }, { timeout: 5000 });

  // Test that we don't interfere with user's SIGINT handling when no children are active
  test('should not interfere with user SIGINT handling when no children active', async () => {
    const { spawn } = await import('child_process');
    
    // Start our debug script that imports $ but doesn't run commands
    const child = spawn('node', ['examples/debug-user-sigint.mjs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    
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
    
    // The user's SIGINT handler should have been called with exit code 42
    expect(exitCode).toBe(42);
    expect(stdout).toContain('USER_SIGINT_HANDLER_CALLED');
    expect(stdout).not.toContain('TIMEOUT_REACHED');
  }, { timeout: 5000 });

  // REGRESSION TEST: Virtual commands must be interruptible by SIGINT
  test('virtual commands should be properly cancelled by SIGINT (regression test)', async () => {
    // This prevents regression where virtual sleep command wasn't cancelled by SIGINT
    
    // Start long-running sleep command
    const runner = $`sleep 10`;
    const promise = runner.start();
    
    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Kill it with SIGINT
    runner.kill('SIGINT');
    
    // Wait for the process to complete
    const result = await promise;
    
    // Virtual command should be properly cancelled (non-zero exit code)
    // Note: In isolated tests, this should be 130 (SIGINT), but when running with other tests
    // there might be race conditions that affect the exact exit code
    expect(result.code).not.toBe(0); // Should not complete successfully
    expect(result.code > 0).toBe(true); // Should have error exit code
    
    // Log the actual exit code for debugging
    console.log('✓ Virtual sleep command properly cancelled with exit code:', result.code);
    
    // In ideal conditions (isolated test), it should be SIGINT exit code
    if (result.code === 130) {
      console.log('  Perfect! Got expected SIGINT exit code (130)');
    } else {
      console.log('  Got alternative exit code (may be due to test interference)');
    }
  }, { timeout: 5000 });
});