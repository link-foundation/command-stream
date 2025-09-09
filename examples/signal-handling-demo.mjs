#!/usr/bin/env node

/**
 * Signal Handling Demonstration
 * 
 * This example demonstrates how to send different signals (SIGTERM, SIGINT, SIGKILL, etc.)
 * to executed commands using the command-stream library.
 * 
 * Usage:
 *   node examples/signal-handling-demo.mjs
 */

import { $ } from '../src/$.mjs';

console.log('🔧 Signal Handling Demo - Various signal types\n');

async function demoSignalTypes() {
  console.log('1. SIGINT (CTRL+C) Example - Exit code 130');
  
  try {
    const runner1 = $`sleep 5`;
    const promise1 = runner1.start();
    
    // Send SIGINT after 1 second
    setTimeout(() => {
      console.log('   📡 Sending SIGINT...');
      runner1.kill('SIGINT');
    }, 1000);
    
    const result1 = await promise1;
    console.log('   ✓ Exit code:', result1.code); // Should be 130
  } catch (error) {
    console.log('   ✓ Command interrupted with exit code:', error.code);
  }
  
  console.log('\n2. SIGTERM (Graceful termination) Example - Exit code 143');
  
  try {
    const runner2 = $`sleep 5`;
    const promise2 = runner2.start();
    
    // Send SIGTERM after 1 second  
    setTimeout(() => {
      console.log('   📡 Sending SIGTERM...');
      runner2.kill('SIGTERM'); // or just runner2.kill() - SIGTERM is default
    }, 1000);
    
    const result2 = await promise2;
    console.log('   ✓ Exit code:', result2.code); // Should be 143
  } catch (error) {
    console.log('   ✓ Command terminated with exit code:', error.code);
  }
  
  console.log('\n3. SIGKILL (Force termination) Example - Exit code 137');
  
  try {
    const runner3 = $`sleep 5`;
    const promise3 = runner3.start();
    
    // Send SIGKILL after 1 second
    setTimeout(() => {
      console.log('   📡 Sending SIGKILL...');
      runner3.kill('SIGKILL');
    }, 1000);
    
    const result3 = await promise3;
    console.log('   ✓ Exit code:', result3.code); // Should be 137
  } catch (error) {
    console.log('   ✓ Command force-killed with exit code:', error.code);
  }
}

async function demoGracefulShutdown() {
  console.log('\n4. Graceful Shutdown Pattern (SIGTERM → SIGKILL escalation)');
  
  async function gracefulShutdown(runner, timeoutMs = 3000) {
    console.log('   📡 Requesting graceful shutdown with SIGTERM...');
    
    // Step 1: Send SIGTERM (polite request)
    runner.kill('SIGTERM');
    
    // Step 2: Wait for graceful shutdown with timeout
    const shutdownTimeout = setTimeout(() => {
      console.log('   ⏰ Graceful shutdown timeout, sending SIGKILL...');
      runner.kill('SIGKILL'); // Force termination
    }, timeoutMs);
    
    try {
      const result = await runner;
      clearTimeout(shutdownTimeout);
      console.log('   ✓ Process exited gracefully with code:', result.code);
      return result;
    } catch (error) {
      clearTimeout(shutdownTimeout);
      console.log('   ✓ Process terminated with code:', error.code);
      return error;
    }
  }
  
  const runner = $`sleep 10`;
  runner.start();
  
  // Wait 1 second then try graceful shutdown
  setTimeout(() => {
    gracefulShutdown(runner, 2000); // 2 second timeout for demo
  }, 1000);
}

async function demoInteractiveCommandTermination() {
  console.log('\n5. Interactive Command Termination (ping example)');
  
  // Commands like ping ignore stdin but respond to signals
  async function runPingWithTimeout(host, timeoutSeconds = 3) {
    console.log(`   📡 Starting ping to ${host} for ${timeoutSeconds} seconds...`);
    
    const pingRunner = $`ping ${host}`;
    const promise = pingRunner.start();
    
    // Set up timeout to send SIGINT after specified time
    const timeoutId = setTimeout(() => {
      console.log(`   ⏰ Stopping ping after ${timeoutSeconds} seconds...`);
      pingRunner.kill('SIGINT'); // Same as pressing CTRL+C
    }, timeoutSeconds * 1000);
    
    try {
      const result = await promise;
      clearTimeout(timeoutId);
      console.log('   ✓ Ping completed naturally with exit code:', result.code);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      console.log('   ✓ Ping interrupted with exit code:', error.code); // Usually 130
      return error;
    }
  }
  
  // Run ping for 3 seconds then automatically stop
  await runPingWithTimeout('8.8.8.8', 3);
}

async function demoUserDefinedSignals() {
  console.log('\n6. User-Defined Signals (SIGUSR1, SIGUSR2)');
  console.log('   Note: Most commands ignore these signals unless specifically programmed to handle them');
  
  try {
    const runner = $`sleep 5`;
    const promise = runner.start();
    
    // Send SIGUSR1 after 1 second
    setTimeout(() => {
      console.log('   📡 Sending SIGUSR1 (most processes will ignore this)...');
      runner.kill('SIGUSR1');
    }, 1000);
    
    // Send SIGUSR2 after 2 seconds  
    setTimeout(() => {
      console.log('   📡 Sending SIGUSR2 (most processes will ignore this)...');
      runner.kill('SIGUSR2');
    }, 2000);
    
    // Finally send SIGINT after 3 seconds to actually terminate
    setTimeout(() => {
      console.log('   📡 Sending SIGINT to actually terminate...');
      runner.kill('SIGINT');
    }, 3000);
    
    const result = await promise;
    console.log('   ✓ Final exit code:', result.code);
  } catch (error) {
    console.log('   ✓ Command terminated with exit code:', error.code);
  }
}

// Run all demonstrations
async function main() {
  await demoSignalTypes();
  await demoGracefulShutdown();
  await demoInteractiveCommandTermination();
  await demoUserDefinedSignals();
  
  console.log('\n🎉 Signal handling demonstration completed!');
  console.log('\nKey takeaways:');
  console.log('• SIGINT (CTRL+C) → Exit code 130');
  console.log('• SIGTERM (default kill) → Exit code 143'); 
  console.log('• SIGKILL (force kill) → Exit code 137');
  console.log('• Use graceful shutdown pattern: SIGTERM → wait → SIGKILL');
  console.log('• Interactive commands like ping need signals, not stdin');
  console.log('• User signals (SIGUSR1, SIGUSR2) are ignored by most processes');
}

main().catch(console.error);