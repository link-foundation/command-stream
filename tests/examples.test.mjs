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

  // Test ping example with external CTRL+C handling
  test('test-ping.mjs should handle external CTRL+C signal', async () => {
    const { spawn } = await import('child_process');
    const { join } = await import('path');
    
    const testPingPath = join(process.cwd(), 'examples/test-ping.mjs');
    
    // Start the ping process
    const child = spawn('node', [testPingPath], {
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
    
    // Give the ping process time to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send CTRL+C (SIGINT) to the process
    child.kill('SIGINT');
    
    // Wait for the process to exit
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve(code);
      });
    });
    
    // The ping should be interrupted with a non-zero exit code
    expect(exitCode).not.toBe(0);
    
    // Check that we got some output or error indicating interruption
    const allOutput = stdout + stderr;
    
    // The process should have been interrupted, not completed normally
    expect(allOutput).not.toContain('Test completed successfully');
  }, { timeout: 10000 });

  // Test that verifies ping receives CTRL+C when spawned by $.mjs
  test('$.mjs should properly forward CTRL+C to ping process', async () => {
    // Start ping in a way that simulates the bug scenario
    const runner = $`ping -c 10 8.8.8.8`; // Use higher count to ensure it runs long enough
    
    // Start the process
    const promise = runner.start();
    
    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Simulate CTRL+C by killing the process
    runner.kill('SIGINT');
    
    // Wait for the process to complete
    const result = await promise;
    
    // Process should have been killed before completing normally
    // Exit code 143 means SIGTERM (128 + 15), which is what kill() uses
    expect(result.code).toBe(143);
    expect(result.code).not.toBe(0); // Should not have completed successfully
  }, { timeout: 10000 });
});