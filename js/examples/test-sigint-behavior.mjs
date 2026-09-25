#!/usr/bin/env node

/**
 * Example: Testing SIGINT behavior across different scenarios
 *
 * This helps debug why SIGINT tests might fail in different environments
 */

import { spawn } from 'child_process';
import { $ } from '../src/$.mjs';

console.log('Testing SIGINT behavior');

// Test 1: Basic shell command with SIGINT
async function testBasicShellSigint() {
  console.log('\nTEST 1: Basic shell command with SIGINT');

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', 'echo "START" && sleep 30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    console.log(`Started process with PID: ${child.pid}`);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Received stdout:', data.toString().trim());
    });

    // Wait for initial output
    setTimeout(() => {
      console.log('Sending SIGINT...');
      child.kill('SIGINT');
    }, 500);

    child.on('exit', (code, signal) => {
      console.log(`Process exited with code: ${code}, signal: ${signal}`);
      console.log(`Total stdout received: ${stdout}`);

      // Expected: code=null, signal='SIGINT' OR code=130, signal=null
      const exitCode = code !== null ? code : signal === 'SIGINT' ? 130 : 1;
      console.log(`Effective exit code: ${exitCode}`);

      resolve({ stdout, exitCode, signal });
    });
  });
}

// Test 2: Shell with trap for SIGINT
async function testShellWithTrap() {
  console.log('\nTEST 2: Shell with trap for SIGINT');

  const script = `
    echo "START_WITH_TRAP"
    trap 'echo "Caught SIGINT"; exit 130' INT
    sleep 30
  `;

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    console.log(`Started process with PID: ${child.pid}`);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Received stdout:', data.toString().trim());
    });

    setTimeout(() => {
      console.log('Sending SIGINT...');
      child.kill('SIGINT');
    }, 500);

    child.on('exit', (code, signal) => {
      console.log(`Process exited with code: ${code}, signal: ${signal}`);
      resolve({ stdout, code, signal });
    });
  });
}

// Test 3: Process group handling
async function testProcessGroup() {
  console.log('\nTEST 3: Process group SIGINT');

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', 'echo "GROUP_START" && sleep 30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Creates new process group
    });

    const pgid = -child.pid;
    console.log(`Started process with PID: ${child.pid}, PGID: ${pgid}`);

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Received stdout:', data.toString().trim());
    });

    setTimeout(() => {
      console.log('Killing entire process group...');
      try {
        process.kill(pgid, 'SIGINT');
      } catch (err) {
        console.log('Failed to kill process group, killing child directly');
        child.kill('SIGINT');
      }
    }, 500);

    child.on('exit', (code, signal) => {
      console.log(`Process exited with code: ${code}, signal: ${signal}`);
      resolve({ stdout, code, signal });
    });
  });
}

// Test 4: Command-stream library SIGINT handling
async function testCommandStreamSigint() {
  console.log('\nTEST 4: Command-stream library SIGINT');

  const runner = $`echo "LIBRARY_START" && sleep 30`;
  const promise = runner.start();

  let output = '';
  runner.on('data', (chunk) => {
    output += chunk.data.toString();
    console.log('Received data:', chunk.data.toString().trim());
  });

  setTimeout(() => {
    console.log('Killing runner...');
    runner.kill();
  }, 500);

  try {
    const result = await promise;
    console.log('Command completed normally:', result);
    return { output, result };
  } catch (error) {
    console.log('Command was interrupted:', error.message);
    return { output, error: error.message };
  }
}

// Test 5: Different kill signals
async function testDifferentSignals() {
  console.log('\nTEST 5: Different signals (SIGINT vs SIGTERM vs SIGKILL)');

  const signals = ['SIGINT', 'SIGTERM', 'SIGKILL'];

  for (const signal of signals) {
    console.log(`\nTesting ${signal}:`);

    await new Promise((resolve) => {
      const child = spawn('sh', ['-c', 'sleep 30'], {
        stdio: 'ignore',
        detached: true,
      });

      console.log(`Started PID ${child.pid}`);

      setTimeout(() => {
        console.log(`Sending ${signal}...`);
        child.kill(signal);
      }, 100);

      child.on('exit', (code, sig) => {
        console.log(`Exit: code=${code}, signal=${sig}`);
        resolve();
      });
    });
  }
}

// Test 6: Platform-specific behavior
async function testPlatformSpecific() {
  console.log('\nTEST 6: Platform-specific SIGINT behavior');

  console.log('Platform:', process.platform);
  console.log('Node version:', process.version);

  // macOS vs Linux might handle signals differently
  if (process.platform === 'darwin') {
    console.log('macOS: Testing with /bin/sleep');
    const child = spawn('/bin/sleep', ['30'], {
      stdio: 'ignore',
    });

    setTimeout(() => {
      child.kill('SIGINT');
    }, 100);

    await new Promise((resolve) => {
      child.on('exit', (code, signal) => {
        console.log(`macOS /bin/sleep exit: code=${code}, signal=${signal}`);
        resolve();
      });
    });
  } else {
    console.log('Linux: Testing with sleep command');
    const child = spawn('sleep', ['30'], {
      stdio: 'ignore',
    });

    setTimeout(() => {
      child.kill('SIGINT');
    }, 100);

    await new Promise((resolve) => {
      child.on('exit', (code, signal) => {
        console.log(`Linux sleep exit: code=${code}, signal=${signal}`);
        resolve();
      });
    });
  }
}

// Main execution
async function main() {
  try {
    await testBasicShellSigint();
    await testShellWithTrap();
    await testProcessGroup();
    await testCommandStreamSigint();
    await testDifferentSignals();
    await testPlatformSpecific();

    console.log('\n✅ All SIGINT tests completed');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
