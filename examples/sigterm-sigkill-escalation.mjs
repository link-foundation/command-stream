#!/usr/bin/env node

/**
 * SIGTERM → SIGKILL Escalation Pattern
 * 
 * Demonstrates the proper pattern for graceful shutdown with escalation:
 * 1. Send SIGTERM (graceful termination request)
 * 2. Wait for process to exit gracefully
 * 3. If timeout exceeded, send SIGKILL (force termination)
 * 
 * Usage:
 *   node examples/sigterm-sigkill-escalation.mjs
 */

import { $ } from '../src/$.mjs';

console.log('📡 SIGTERM → SIGKILL Escalation Demo\n');

/**
 * Graceful shutdown with escalation
 * @param {ProcessRunner} runner - The command runner to shutdown
 * @param {number} timeoutMs - Timeout in milliseconds before escalating to SIGKILL
 * @returns {Promise} Resolves with the result or error
 */
async function gracefulShutdownWithEscalation(runner, timeoutMs = 5000) {
  console.log('🔄 Starting graceful shutdown sequence...');
  
  // Step 1: Send SIGTERM (polite termination request)
  console.log('📤 Step 1: Sending SIGTERM (graceful termination request)');
  runner.kill('SIGTERM');
  
  // Step 2: Set up timeout for escalation to SIGKILL
  let escalationTimeout;
  const escalationPromise = new Promise((resolve) => {
    escalationTimeout = setTimeout(() => {
      console.log(`⏰ Step 2: Timeout (${timeoutMs}ms) exceeded, escalating to SIGKILL`);
      runner.kill('SIGKILL'); // Force termination
      resolve('escalated');
    }, timeoutMs);
  });
  
  // Step 3: Race between graceful exit and escalation timeout
  try {
    const result = await Promise.race([
      runner,  // Wait for process to exit
      escalationPromise  // Wait for escalation timeout
    ]);
    
    if (result === 'escalated') {
      // Escalation timeout triggered, now wait for SIGKILL to take effect
      console.log('🔪 SIGKILL sent, waiting for process termination...');
      const finalResult = await runner;
      console.log('✓ Process force-terminated with exit code:', finalResult.code);
      return finalResult;
    } else {
      // Process exited gracefully before timeout
      clearTimeout(escalationTimeout);
      console.log('✅ Process exited gracefully with exit code:', result.code);
      return result;
    }
  } catch (error) {
    clearTimeout(escalationTimeout);
    console.log('✓ Process terminated with exit code:', error.code);
    return error;
  }
}

/**
 * Simulate different process behaviors for testing escalation
 */
async function testEscalationScenarios() {
  console.log('Testing different escalation scenarios:\n');
  
  // Scenario 1: Process exits gracefully (within timeout)
  console.log('📋 Scenario 1: Process that exits quickly (graceful)');
  const runner1 = $`sleep 1`; // Short sleep - will exit before timeout
  runner1.start();
  await gracefulShutdownWithEscalation(runner1, 3000); // 3 second timeout
  
  console.log('\n' + '─'.repeat(50) + '\n');
  
  // Scenario 2: Process requires escalation (exceeds timeout)  
  console.log('📋 Scenario 2: Process that requires SIGKILL (escalation needed)');
  const runner2 = $`sleep 10`; // Long sleep - will exceed timeout
  runner2.start();
  // Give it a moment to start then try shutdown with short timeout
  setTimeout(() => {
    gracefulShutdownWithEscalation(runner2, 2000); // 2 second timeout - will escalate
  }, 500);
  
  // Wait a bit for the escalation demo to complete
  await new Promise(resolve => setTimeout(resolve, 4000));
}

/**
 * Production-ready graceful shutdown function
 */
function createGracefulShutdown(options = {}) {
  const {
    sigterm_timeout = 5000,  // Time to wait for SIGTERM before SIGKILL
    sigkill_timeout = 2000,  // Time to wait for SIGKILL before giving up
    verbose = true
  } = options;
  
  return async function shutdown(runner, reason = 'shutdown requested') {
    if (verbose) console.log(`🛑 Graceful shutdown initiated: ${reason}`);
    
    // Phase 1: SIGTERM
    if (verbose) console.log('📤 Phase 1: Sending SIGTERM...');
    runner.kill('SIGTERM');
    
    // Phase 2: Wait for graceful exit or timeout
    const phase1Promise = new Promise((resolve) => {
      setTimeout(() => resolve('timeout'), sigterm_timeout);
    });
    
    try {
      const result = await Promise.race([runner, phase1Promise]);
      
      if (result === 'timeout') {
        // Phase 3: SIGKILL escalation
        if (verbose) console.log(`⏰ Phase 2: SIGTERM timeout (${sigterm_timeout}ms), sending SIGKILL...`);
        runner.kill('SIGKILL');
        
        // Phase 4: Wait for SIGKILL or final timeout
        const phase3Promise = new Promise((resolve) => {
          setTimeout(() => resolve('final_timeout'), sigkill_timeout);
        });
        
        const finalResult = await Promise.race([runner, phase3Promise]);
        
        if (finalResult === 'final_timeout') {
          if (verbose) console.log('❌ Final timeout: Process may be hung (this should not happen with SIGKILL)');
          throw new Error('Process termination failed even with SIGKILL');
        } else {
          if (verbose) console.log('✓ Process terminated with SIGKILL, exit code:', finalResult.code);
          return finalResult;
        }
      } else {
        if (verbose) console.log('✅ Process exited gracefully, exit code:', result.code);
        return result;
      }
    } catch (error) {
      if (verbose) console.log('✓ Process terminated, exit code:', error.code);
      return error;
    }
  };
}

async function testProductionShutdown() {
  console.log('\n' + '='.repeat(60));
  console.log('🏭 Production-Ready Shutdown Function Test\n');
  
  // Create shutdown function with custom options
  const shutdown = createGracefulShutdown({
    sigterm_timeout: 3000,  // 3 seconds for graceful exit
    sigkill_timeout: 1000,  // 1 second for SIGKILL to take effect  
    verbose: true
  });
  
  console.log('📋 Testing production shutdown with long-running process');
  const runner = $`sleep 20`; // Long-running process
  runner.start();
  
  // Wait a moment then shutdown
  setTimeout(() => {
    shutdown(runner, 'application shutdown');
  }, 1000);
  
  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 6000));
}

// Run all tests
async function main() {
  await testEscalationScenarios();
  await testProductionShutdown();
  
  console.log('\n🎉 SIGTERM → SIGKILL Escalation Demo completed!');
  console.log('\nBest Practices:');
  console.log('• Always try SIGTERM first (graceful)');
  console.log('• Set reasonable timeouts (5-30 seconds typical)');
  console.log('• Escalate to SIGKILL if SIGTERM timeout exceeded');
  console.log('• SIGKILL cannot be ignored - it always works');
  console.log('• Monitor exit codes: 143 (SIGTERM), 137 (SIGKILL)');
}

main().catch(console.error);