#!/usr/bin/env node

/**
 * CTRL+C vs SIGTERM Comparison
 * 
 * Demonstrates the differences between:
 * - CTRL+C (SIGINT) - User interrupt signal
 * - SIGTERM - Termination request signal (default for kill command)
 * 
 * Both can be caught by processes, but they have different semantic meanings.
 * 
 * Usage:
 *   node examples/ctrl-c-vs-sigterm.mjs
 */

import { $ } from '../src/$.mjs';

console.log('🔄 CTRL+C (SIGINT) vs SIGTERM Comparison\n');

async function demonstrateSignalDifferences() {
  console.log('Understanding the difference between SIGINT and SIGTERM:\n');
  
  console.log('📝 SIGINT (Signal 2) - "Interrupt" - Usually CTRL+C');
  console.log('   • Semantic meaning: User wants to interrupt/cancel');
  console.log('   • Common sources: Terminal CTRL+C, kill -2, kill -INT');
  console.log('   • Exit code when caught: Usually 130 (128 + 2)');
  console.log('   • Can be caught and handled by programs');
  
  console.log('\n📝 SIGTERM (Signal 15) - "Terminate" - Default kill signal');
  console.log('   • Semantic meaning: Request to terminate gracefully');
  console.log('   • Common sources: kill command (default), systemd, process managers');
  console.log('   • Exit code when caught: Usually 143 (128 + 15)');
  console.log('   • Can be caught and handled by programs');
  
  console.log('\n' + '─'.repeat(50) + '\n');
}

async function testSigintBehavior() {
  console.log('🧪 Testing SIGINT (CTRL+C equivalent) behavior:');
  
  try {
    const runner = $`sleep 5`;
    const promise = runner.start();
    
    // Send SIGINT after 1 second
    setTimeout(() => {
      console.log('   📤 Sending SIGINT (equivalent to pressing CTRL+C)...');
      runner.kill('SIGINT');
    }, 1000);
    
    const result = await promise;
    console.log('   ✓ SIGINT result - Exit code:', result.code, '(should be 130)');
  } catch (error) {
    console.log('   ✓ SIGINT interrupted with exit code:', error.code);
  }
}

async function testSigtermBehavior() {
  console.log('\n🧪 Testing SIGTERM (default kill) behavior:');
  
  try {
    const runner = $`sleep 5`;
    const promise = runner.start();
    
    // Send SIGTERM after 1 second
    setTimeout(() => {
      console.log('   📤 Sending SIGTERM (default kill signal)...');
      runner.kill('SIGTERM'); // or just runner.kill() - SIGTERM is default
    }, 1000);
    
    const result = await promise;
    console.log('   ✓ SIGTERM result - Exit code:', result.code, '(should be 143)');
  } catch (error) {
    console.log('   ✓ SIGTERM terminated with exit code:', error.code);
  }
}

async function testDefaultKillBehavior() {
  console.log('\n🧪 Testing default kill() behavior (should be SIGTERM):');
  
  try {
    const runner = $`sleep 5`;
    const promise = runner.start();
    
    // Default kill (should send SIGTERM)
    setTimeout(() => {
      console.log('   📤 Calling kill() without signal (defaults to SIGTERM)...');
      runner.kill(); // No signal specified - should default to SIGTERM
    }, 1000);
    
    const result = await promise;
    console.log('   ✓ Default kill() result - Exit code:', result.code, '(should be 143 for SIGTERM)');
  } catch (error) {
    console.log('   ✓ Default kill() terminated with exit code:', error.code);
  }
}

async function demonstrateExitCodes() {
  console.log('\n📊 Exit Code Demonstration:');
  console.log('Formula: Exit Code = 128 + Signal Number');
  console.log('• SIGINT (2): 128 + 2 = 130');
  console.log('• SIGTERM (15): 128 + 15 = 143');
  console.log('• SIGKILL (9): 128 + 9 = 137');
  
  const signals = [
    { name: 'SIGINT', number: 2, expected: 130 },
    { name: 'SIGTERM', number: 15, expected: 143 },
    { name: 'SIGKILL', number: 9, expected: 137 }
  ];
  
  console.log('\n🧮 Testing exit code formula:');
  
  for (const signal of signals) {
    try {
      const runner = $`sleep 3`;
      const promise = runner.start();
      
      setTimeout(() => {
        console.log(`   📤 Sending ${signal.name}...`);
        runner.kill(signal.name);
      }, 500);
      
      const result = await promise;
      const match = result.code === signal.expected ? '✅' : '❌';
      console.log(`   ${match} ${signal.name} → Exit code: ${result.code} (expected: ${signal.expected})`);
    } catch (error) {
      const match = error.code === signal.expected ? '✅' : '❌';
      console.log(`   ${match} ${signal.name} → Exit code: ${error.code} (expected: ${signal.expected})`);
    }
  }
}

async function demonstrateRealWorldUsage() {
  console.log('\n🌍 Real-world Usage Examples:');
  
  console.log('\n1️⃣ User interruption (CTRL+C equivalent):');
  console.log('   Use SIGINT when user wants to cancel/interrupt');
  
  // Simulate user pressing CTRL+C
  const pingRunner = $`ping -c 10 8.8.8.8`;
  const pingPromise = pingRunner.start();
  
  setTimeout(() => {
    console.log('   👤 User pressed CTRL+C - sending SIGINT...');
    pingRunner.kill('SIGINT'); // User interruption
  }, 2000);
  
  try {
    await pingPromise;
  } catch (error) {
    console.log('   ✓ Ping interrupted by user, exit code:', error.code);
  }
  
  console.log('\n2️⃣ System shutdown (graceful termination):');
  console.log('   Use SIGTERM for graceful shutdown requests');
  
  // Simulate system requesting graceful shutdown
  const serverRunner = $`sleep 8`; // Simulate server process
  const serverPromise = serverRunner.start();
  
  setTimeout(() => {
    console.log('   🏭 System requesting graceful shutdown - sending SIGTERM...');
    serverRunner.kill('SIGTERM'); // System shutdown
  }, 1000);
  
  try {
    await serverPromise;
  } catch (error) {
    console.log('   ✓ Server gracefully terminated, exit code:', error.code);
  }
}

async function main() {
  await demonstrateSignalDifferences();
  await testSigintBehavior();
  await testSigtermBehavior();
  await testDefaultKillBehavior();
  await demonstrateExitCodes();
  await demonstrateRealWorldUsage();
  
  console.log('\n🎉 CTRL+C vs SIGTERM Comparison completed!');
  console.log('\nKey Takeaways:');
  console.log('• SIGINT (CTRL+C): User interruption → Exit code 130');
  console.log('• SIGTERM: Graceful termination → Exit code 143');
  console.log('• Both can be caught and handled by processes');
  console.log('• Default kill() sends SIGTERM, not SIGINT');
  console.log('• Exit codes follow formula: 128 + signal number');
  console.log('• Choose signal based on semantic meaning, not just functionality');
}

main().catch(console.error);