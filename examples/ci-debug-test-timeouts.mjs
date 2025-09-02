#!/usr/bin/env node

/**
 * Example: Debugging test timeout issues in CI
 * 
 * Problem: Tests hang indefinitely in CI without proper timeout configuration,
 * causing the entire CI job to timeout after hours.
 * 
 * Solution: Add proper timeouts to all tests and handle stuck processes.
 */

import { spawn } from 'child_process';
import { $ } from '../src/$.mjs';

console.log('Testing timeout handling strategies');

// Example 1: Test with no timeout (problematic)
async function testNoTimeout() {
  console.log('\nTEST 1: Command with no timeout (problematic)');
  console.log('This would hang forever in CI...');
  
  // DON'T DO THIS - example of what to avoid
  // const result = await $`sleep 999999`;
  
  console.log('Skipping actual execution to prevent hang');
}

// Example 2: Test with promise race timeout
async function testPromiseRaceTimeout() {
  console.log('\nTEST 2: Using Promise.race for timeout');
  
  const command = $`sleep 30`;
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Command timeout')), 2000);
  });
  
  try {
    const result = await Promise.race([command, timeout]);
    console.log('Command completed:', result.stdout);
  } catch (error) {
    console.log('✓ Command timed out as expected:', error.message);
    // Clean up the command
    command.kill();
  }
}

// Example 3: Test with AbortController
async function testAbortController() {
  console.log('\nTEST 3: Using AbortController for timeout');
  
  const controller = new AbortController();
  
  // Set timeout
  const timeoutId = setTimeout(() => {
    console.log('Timeout reached, aborting...');
    controller.abort();
  }, 2000);
  
  try {
    const result = await $`sleep 30`.start({ signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('Command completed:', result.stdout);
  } catch (error) {
    console.log('✓ Command aborted:', error.message);
  }
}

// Example 4: Custom timeout wrapper
async function withTimeout(promise, ms, message = 'Operation timed out') {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
  
  return Promise.race([promise, timeout]);
}

async function testCustomTimeoutWrapper() {
  console.log('\nTEST 4: Custom timeout wrapper');
  
  try {
    const result = await withTimeout(
      $`sleep 30`,
      2000,
      'Command exceeded 2 second timeout'
    );
    console.log('Command completed:', result.stdout);
  } catch (error) {
    console.log('✓ Timeout wrapper worked:', error.message);
  }
}

// Example 5: Bun test timeout pattern
async function testBunTestPattern() {
  console.log('\nTEST 5: Bun test timeout pattern');
  
  // This shows how to add timeouts in Bun tests
  const exampleTest = `
    import { test, expect } from 'bun:test';
    
    // WITHOUT TIMEOUT - Can hang forever
    test('problematic test', async () => {
      await $\`sleep 999999\`;
    });
    
    // WITH TIMEOUT - Will fail after 5 seconds
    test('properly configured test', async () => {
      await $\`sleep 999999\`;
    }, 5000); // <-- Timeout in milliseconds
    
    // WITH CUSTOM TIMEOUT for long operations
    test('long running test', async () => {
      // Some operation that legitimately takes time
      await $\`npm install\`;
    }, 60000); // 60 second timeout
  `;
  
  console.log('Example Bun test with timeout:');
  console.log(exampleTest);
}

// Example 6: Detecting stuck processes
async function testStuckProcessDetection() {
  console.log('\nTEST 6: Detecting stuck processes');
  
  const child = spawn('sleep', ['30'], {
    stdio: 'pipe'
  });
  
  console.log(`Started process with PID ${child.pid}`);
  
  // Monitor for inactivity
  let lastActivity = Date.now();
  const inactivityTimeout = 2000; // 2 seconds
  
  const monitor = setInterval(() => {
    const idle = Date.now() - lastActivity;
    if (idle > inactivityTimeout) {
      console.log(`Process ${child.pid} appears stuck (idle for ${idle}ms)`);
      console.log('Killing stuck process...');
      child.kill('SIGKILL');
      clearInterval(monitor);
    }
  }, 500);
  
  // Update activity on any output
  child.stdout.on('data', () => {
    lastActivity = Date.now();
  });
  child.stderr.on('data', () => {
    lastActivity = Date.now();
  });
  
  await new Promise(resolve => {
    child.on('exit', (code, signal) => {
      clearInterval(monitor);
      console.log(`Process exited with code ${code}, signal ${signal}`);
      resolve();
    });
  });
}

// Example 7: CI-specific timeout configuration
async function testCITimeoutConfig() {
  console.log('\nTEST 7: CI-specific timeout configuration');
  
  const isCI = process.env.CI === 'true';
  
  // Use different timeouts for CI vs local
  const timeouts = {
    default: isCI ? 30000 : 5000,      // 30s in CI, 5s local
    long: isCI ? 120000 : 30000,       // 2min in CI, 30s local
    network: isCI ? 60000 : 10000,     // 1min in CI, 10s local
  };
  
  console.log('Timeout configuration:');
  console.log(`- Environment: ${isCI ? 'CI' : 'Local'}`);
  console.log(`- Default timeout: ${timeouts.default}ms`);
  console.log(`- Long operation timeout: ${timeouts.long}ms`);
  console.log(`- Network operation timeout: ${timeouts.network}ms`);
  
  // Example usage
  try {
    await withTimeout(
      $`sleep 30`,
      timeouts.default,
      `Command exceeded ${isCI ? 'CI' : 'local'} timeout`
    );
  } catch (error) {
    console.log('✓ CI-aware timeout worked:', error.message);
  }
}

// Example 8: Cleanup after timeout
async function testTimeoutCleanup() {
  console.log('\nTEST 8: Cleanup after timeout');
  
  const runners = [];
  const startRunner = (name) => {
    const runner = $`sleep 30`;
    runners.push({ name, runner });
    return runner.start();
  };
  
  // Start multiple commands
  const promises = [
    startRunner('command1'),
    startRunner('command2'),
    startRunner('command3')
  ];
  
  // Set global timeout
  setTimeout(() => {
    console.log('Global timeout reached, cleaning up all runners...');
    runners.forEach(({ name, runner }) => {
      if (!runner.finished) {
        console.log(`Killing ${name}`);
        runner.kill();
      }
    });
  }, 2000);
  
  // Wait for all to finish (either naturally or by timeout)
  const results = await Promise.allSettled(promises);
  
  results.forEach((result, i) => {
    const status = result.status === 'fulfilled' ? 'completed' : 'failed';
    console.log(`${runners[i].name}: ${status}`);
  });
  
  // Verify cleanup
  const unfinished = runners.filter(r => !r.runner.finished);
  console.log(`Unfinished runners: ${unfinished.length}`);
}

// Run tests
async function main() {
  try {
    console.log('Environment:');
    console.log(`- CI: ${process.env.CI || 'false'}`);
    console.log(`- Node: ${process.version}`);
    console.log(`- Platform: ${process.platform}`);
    
    await testNoTimeout();
    await testPromiseRaceTimeout();
    await testAbortController();
    await testCustomTimeoutWrapper();
    await testBunTestPattern();
    await testStuckProcessDetection();
    await testCITimeoutConfig();
    await testTimeoutCleanup();
    
    console.log('\nAll timeout tests completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();