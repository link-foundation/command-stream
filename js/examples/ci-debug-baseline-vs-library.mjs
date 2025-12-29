#!/usr/bin/env node

/**
 * Example: Testing baseline spawn behavior vs command-stream library
 *
 * Problem: When tests fail in CI, it's important to determine if the issue
 * is with the library or with the underlying Node.js spawn behavior.
 *
 * Solution: Test both baseline (raw spawn) and library functionality to compare.
 */

import { spawn } from 'child_process';
import { $ } from '../js/src/$.mjs';

console.log('Testing baseline vs library behavior');

// Example 1: Baseline spawn test (no library)
async function testBaselineSpawn() {
  console.log('\nTEST 1: Baseline spawn (no command-stream)');

  return new Promise((resolve, reject) => {
    const child = spawn('echo', ['baseline test'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Baseline stdout:', data.toString().trim());
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Baseline stderr:', data.toString().trim());
    });

    child.on('exit', (code, signal) => {
      console.log(`Baseline exit: code=${code}, signal=${signal}`);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Baseline failed: ${code}/${signal}`));
      }
    });

    child.on('error', (error) => {
      console.log('Baseline error:', error.message);
      reject(error);
    });
  });
}

// Example 2: Library test (using command-stream)
async function testLibrary() {
  console.log('\nTEST 2: Library test (using command-stream)');

  try {
    const result = await $`echo "library test"`;
    console.log('Library stdout:', result.stdout.trim());
    console.log(`Library exit: code=${result.code}`);
    return result;
  } catch (error) {
    console.log('Library error:', error.message);
    throw error;
  }
}

// Example 3: Signal handling comparison
async function testSignalHandlingComparison() {
  console.log('\nTEST 3: Signal handling comparison');

  // Baseline signal handling
  console.log('3a. Baseline signal handling:');
  const baselineChild = spawn('sleep', ['30'], {
    stdio: 'inherit',
  });

  setTimeout(() => {
    console.log('Sending SIGTERM to baseline child...');
    baselineChild.kill('SIGTERM');
  }, 1000);

  await new Promise((resolve) => {
    baselineChild.on('exit', (code, signal) => {
      console.log(`Baseline exited: code=${code}, signal=${signal}`);
      resolve();
    });
  });

  // Library signal handling
  console.log('3b. Library signal handling:');
  const runner = $`sleep 30`;
  const promise = runner.start();

  setTimeout(() => {
    console.log('Sending kill to library runner...');
    runner.kill();
  }, 1000);

  try {
    await promise;
  } catch (error) {
    console.log(`Library exited: ${error.message}`);
  }
  console.log(`Library finished: ${runner.finished}`);
}

// Example 4: Streaming comparison
async function testStreamingComparison() {
  console.log('\nTEST 4: Streaming output comparison');

  // Baseline streaming
  console.log('4a. Baseline streaming:');
  await new Promise((resolve) => {
    const child = spawn(
      'sh',
      ['-c', 'for i in 1 2 3; do echo "baseline $i"; sleep 0.1; done'],
      {
        stdio: 'pipe',
      }
    );

    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[Baseline chunk]: ${chunk}`);
    });

    child.on('exit', resolve);
  });

  // Library streaming
  console.log('4b. Library streaming:');
  const runner = $`sh -c 'for i in 1 2 3; do echo "library $i"; sleep 0.1; done'`;

  for await (const chunk of runner.stream()) {
    process.stdout.write(`[Library chunk]: ${chunk.data}`);
  }
}

// Example 5: Error handling comparison
async function testErrorHandlingComparison() {
  console.log('\nTEST 5: Error handling comparison');

  // Baseline error handling
  console.log('5a. Baseline error handling:');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('false', [], { stdio: 'inherit' });
      child.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.log('Baseline error caught:', error.message);
  }

  // Library error handling
  console.log('5b. Library error handling:');
  try {
    await $`false`;
  } catch (error) {
    console.log('Library error caught:', error.message);
  }
}

// Example 6: CI-specific differences
async function testCISpecificDifferences() {
  console.log('\nTEST 6: CI-specific behavior differences');

  const isCI = process.env.CI === 'true';
  const isTTY = process.stdout.isTTY;

  console.log(`Environment: CI=${isCI}, TTY=${isTTY}`);

  // Test that might behave differently in CI
  const testScript = `
    if [ -t 0 ]; then
      echo "TTY detected"
    else
      echo "No TTY (typical in CI)"
    fi
  `;

  // Baseline
  console.log('6a. Baseline TTY detection:');
  await new Promise((resolve) => {
    const child = spawn('sh', ['-c', testScript], {
      stdio: 'inherit',
    });
    child.on('exit', resolve);
  });

  // Library
  console.log('6b. Library TTY detection:');
  const result = await $`sh -c ${testScript}`;
  console.log(result.stdout.trim());
}

// Example 7: Performance comparison
async function testPerformanceComparison() {
  console.log('\nTEST 7: Performance comparison');

  const iterations = 10;

  // Baseline performance
  console.log(`7a. Baseline performance (${iterations} iterations):`);
  const baselineStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => {
      const child = spawn('echo', [`test ${i}`], {
        stdio: 'ignore',
      });
      child.on('exit', resolve);
    });
  }
  const baselineTime = Date.now() - baselineStart;
  console.log(`Baseline time: ${baselineTime}ms`);

  // Library performance
  console.log(`7b. Library performance (${iterations} iterations):`);
  const libraryStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await $({ quiet: true })`echo "test ${i}"`;
  }
  const libraryTime = Date.now() - libraryStart;
  console.log(`Library time: ${libraryTime}ms`);

  console.log(`Overhead: ${libraryTime - baselineTime}ms`);
}

// Run all comparisons
async function main() {
  console.log('Environment info:');
  console.log(`- Node: ${process.version}`);
  console.log(`- Platform: ${process.platform}`);
  console.log(`- CI: ${process.env.CI || 'false'}`);
  console.log(`- TTY: ${process.stdout.isTTY || false}`);

  try {
    await testBaselineSpawn();
    await testLibrary();
    await testSignalHandlingComparison();
    await testStreamingComparison();
    await testErrorHandlingComparison();
    await testCISpecificDifferences();
    await testPerformanceComparison();

    console.log('\n✅ All comparison tests completed successfully');
    console.log('Both baseline and library are working correctly');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('This helps identify if the issue is with:');
    console.error('- The library implementation');
    console.error('- The underlying Node.js spawn behavior');
    console.error('- CI environment configuration');
    process.exit(1);
  }
}

main();
