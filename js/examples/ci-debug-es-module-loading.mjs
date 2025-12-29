#!/usr/bin/env node

/**
 * Example: Debugging ES module loading failures in CI
 *
 * Problem: In CI environments, child processes spawned with ES module imports
 * sometimes fail immediately with SIGINT or other signals.
 *
 * Solution: Use different approaches for loading modules in child processes.
 */

import { spawn } from 'child_process';
import { $ } from '../js/src/$.mjs';

console.log('Testing ES module loading in child processes');

// Example 1: Direct ES module import (may fail in CI)
async function testDirectESModule() {
  console.log('\nTEST 1: Direct ES module import in child process');

  const script = `
    import { $ } from '../js/src/$.mjs';
    console.log('Module loaded successfully');
    const result = await $\`echo "ES module test"\`;
    console.log('Result:', result.stdout);
  `;

  try {
    // This might fail in CI with immediate SIGINT
    const child = spawn('node', ['--input-type=module', '-e', script], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    await new Promise((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (code === 0) {
          console.log('✓ ES module loaded successfully');
          resolve();
        } else {
          console.log(`✗ Failed with code ${code}, signal ${signal}`);
          reject(new Error(`Process failed: ${code}/${signal}`));
        }
      });
    });
  } catch (error) {
    console.log('Expected failure in CI:', error.message);
  }
}

// Example 2: CommonJS fallback approach
async function testCommonJSFallback() {
  console.log('\nTEST 2: CommonJS-style dynamic import');

  const script = `
    (async () => {
      try {
        const module = await import('../src/$.mjs');
        const $ = module.$;
        console.log('Module loaded via dynamic import');
        const result = await $\`echo "Dynamic import test"\`;
        console.log('Result:', result.stdout);
      } catch (error) {
        console.error('Import failed:', error.message);
        process.exit(1);
      }
    })();
  `;

  const child = spawn('node', ['--input-type=module', '-e', script], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      console.log(`Process exited with code ${code}, signal ${signal}`);
      resolve();
    });
  });
}

// Example 3: Simple inline script without imports (most reliable in CI)
async function testInlineScript() {
  console.log('\nTEST 3: Inline script without ES module imports');

  const child = spawn(
    'node',
    [
      '-e',
      `
    console.log('INLINE_START');
    setTimeout(() => {
      console.log('INLINE_END');
      process.exit(0);
    }, 100);
  `,
    ],
    {
      stdio: 'inherit',
    }
  );

  await new Promise((resolve) => {
    child.on('exit', (code) => {
      console.log(`✓ Inline script completed with code ${code}`);
      resolve();
    });
  });
}

// Example 4: Shell command fallback (most compatible)
async function testShellFallback() {
  console.log('\nTEST 4: Shell command fallback');

  // Use shell commands directly when ES modules fail
  const child = spawn(
    'sh',
    ['-c', 'echo "SHELL_START" && sleep 0.1 && echo "SHELL_END"'],
    {
      stdio: 'inherit',
    }
  );

  await new Promise((resolve) => {
    child.on('exit', (code) => {
      console.log(`✓ Shell command completed with code ${code}`);
      resolve();
    });
  });
}

// Example 5: Error handling with detailed diagnostics
async function testWithDiagnostics() {
  console.log('\nTEST 5: Child process with detailed diagnostics');

  const script = `
    console.error('[DIAG] Node version:', process.version);
    console.error('[DIAG] Platform:', process.platform);
    console.error('[DIAG] CWD:', process.cwd());
    console.error('[DIAG] Module paths:', module.paths);
    
    import('../src/$.mjs').then(
      (module) => {
        console.log('SUCCESS: Module loaded');
        process.exit(0);
      },
      (error) => {
        console.error('FAILURE: Cannot load module');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
      }
    );
  `;

  const child = spawn('node', ['--input-type=module', '-e', script], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  await new Promise((resolve) => {
    child.on('exit', resolve);
  });
}

// Run all tests
async function main() {
  console.log('Environment info:');
  console.log('- Node version:', process.version);
  console.log('- Platform:', process.platform);
  console.log('- CI:', process.env.CI || 'false');
  console.log('- GitHub Actions:', process.env.GITHUB_ACTIONS || 'false');

  await testDirectESModule();
  await testCommonJSFallback();
  await testInlineScript();
  await testShellFallback();
  await testWithDiagnostics();

  console.log('\nAll tests completed');
}

main().catch(console.error);
