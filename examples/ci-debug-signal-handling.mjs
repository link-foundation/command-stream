#!/usr/bin/env node

/**
 * Example: Debugging signal handling issues in CI
 *
 * Problem: SIGINT/SIGTERM signals behave differently in CI environments,
 * especially with process groups and detached processes.
 *
 * Solution: Proper signal forwarding and cleanup strategies.
 */

import { spawn } from 'child_process';
import { $ } from '../src/$.mjs';

console.log('Testing signal handling in CI environment');

// Example 1: Basic signal forwarding
async function testBasicSignalForwarding() {
  console.log('\nTEST 1: Basic signal forwarding');

  const child = spawn('sh', ['-c', 'echo "Starting sleep" && sleep 30'], {
    stdio: 'inherit',
    detached: false, // Not detached, stays in same process group
  });

  console.log(`Child PID: ${child.pid}`);

  // Forward SIGINT to child
  const signalHandler = () => {
    console.log('Parent received SIGINT, forwarding to child...');
    child.kill('SIGINT');
  };
  process.on('SIGINT', signalHandler);

  // Simulate SIGINT after 1 second
  setTimeout(() => {
    console.log('Simulating SIGINT...');
    process.kill(process.pid, 'SIGINT');
  }, 1000);

  await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      console.log(`Child exited with code ${code}, signal ${signal}`);
      process.removeListener('SIGINT', signalHandler);
      resolve();
    });
  });
}

// Example 2: Detached process group handling
async function testDetachedProcessGroup() {
  console.log('\nTEST 2: Detached process group');

  const child = spawn('sh', ['-c', 'echo "Detached start" && sleep 30'], {
    stdio: 'inherit',
    detached: true, // Creates new process group
  });

  const pgid = -child.pid; // Negative PID targets the process group
  console.log(`Child PID: ${child.pid}, PGID: ${pgid}`);

  // Kill entire process group
  setTimeout(() => {
    console.log('Killing process group...');
    try {
      process.kill(pgid, 'SIGTERM');
    } catch (error) {
      console.log('Error killing process group:', error.message);
      // Fallback to killing just the child
      child.kill('SIGTERM');
    }
  }, 1000);

  await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      console.log(`Child exited with code ${code}, signal ${signal}`);
      resolve();
    });
  });
}

// Example 3: Signal handling with command-stream
async function testCommandStreamSignals() {
  console.log('\nTEST 3: Command-stream signal handling');

  const runner = $`sleep 30`;
  const promise = runner.start();

  // Log when command starts
  runner.on('start', () => {
    console.log('Command started');
  });

  // Simulate interrupt after 1 second
  setTimeout(() => {
    console.log('Sending kill signal to runner...');
    runner.kill();
  }, 1000);

  try {
    await promise;
    console.log('Command completed normally');
  } catch (error) {
    console.log('Command was interrupted:', error.message);
  }

  console.log('Runner finished:', runner.finished);
}

// Example 4: Cleanup on unexpected exit
async function testCleanupOnExit() {
  console.log('\nTEST 4: Cleanup on unexpected exit');

  const children = [];

  // Cleanup function
  const cleanup = () => {
    console.log('Cleaning up child processes...');
    children.forEach((child) => {
      if (!child.killed) {
        console.log(`Killing child ${child.pid}`);
        child.kill('SIGTERM');
      }
    });
  };

  // Register cleanup handlers
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    console.log('Received SIGINT');
    cleanup();
    process.exit(130); // Standard exit code for SIGINT
  });
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM');
    cleanup();
    process.exit(143); // Standard exit code for SIGTERM
  });

  // Start some child processes
  for (let i = 0; i < 3; i++) {
    const child = spawn('sleep', ['30'], {
      stdio: 'ignore',
    });
    children.push(child);
    console.log(`Started child ${i + 1} with PID ${child.pid}`);
  }

  // Simulate cleanup after 1 second
  setTimeout(() => {
    console.log('Triggering cleanup...');
    cleanup();
  }, 1000);

  // Wait for all children to exit
  await Promise.all(
    children.map((child) => new Promise((resolve) => child.on('exit', resolve)))
  );

  console.log('All children cleaned up');
}

// Example 5: Signal handling in CI vs local environment
async function testEnvironmentDifferences() {
  console.log('\nTEST 5: Environment-specific signal handling');

  const isCI = process.env.CI === 'true';
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  const isTTY = process.stdout.isTTY;

  console.log('Environment:');
  console.log(`- CI: ${isCI}`);
  console.log(`- GitHub Actions: ${isGitHubActions}`);
  console.log(`- TTY: ${isTTY}`);
  console.log(`- Process group: ${process.pid}`);

  // Different strategies based on environment
  if (isCI) {
    console.log('Using CI-optimized signal handling');
    // In CI, we might need more aggressive cleanup
    const child = spawn('sleep', ['30'], {
      stdio: 'inherit',
      detached: false, // Keep in same process group for CI
    });

    setTimeout(() => {
      // Use SIGKILL as last resort in CI
      child.kill('SIGKILL');
    }, 1000);

    await new Promise((resolve) => child.on('exit', resolve));
  } else {
    console.log('Using local development signal handling');
    // In local dev, we can be more graceful
    const child = spawn('sleep', ['30'], {
      stdio: 'inherit',
      detached: true, // Can detach in local environment
    });

    setTimeout(() => {
      // Use SIGTERM for graceful shutdown
      child.kill('SIGTERM');
    }, 1000);

    await new Promise((resolve) => child.on('exit', resolve));
  }
}

// Run tests
async function main() {
  try {
    await testBasicSignalForwarding();
    await testDetachedProcessGroup();
    await testCommandStreamSignals();
    await testCleanupOnExit();
    await testEnvironmentDifferences();

    console.log('\nAll signal handling tests completed');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
