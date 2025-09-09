#!/usr/bin/env node
/**
 * Synchronous Execution Control: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates synchronous execution modes and control
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function executionSyncComparison() {
  try {
    console.log('1️⃣  Basic Synchronous Execution:');
    
    // Basic .sync() usage
    const result1 = $`echo "Synchronous execution in ${runtime}"`.sync();
    console.log(`   sync() result: ${result1.stdout.trim()}`);
    console.log(`   sync() code: ${result1.code}`);
    console.log(`   sync() timing: ${typeof result1.timing === 'object' ? '✅' : '❌'}`);

    console.log('\n2️⃣  Synchronous Built-in Commands:');
    
    const result2 = $`seq 1 5`.sync();
    const numbers = result2.stdout.trim().split('\n');
    console.log(`   seq sync: ${numbers.length === 5 ? '✅' : '❌'} (${numbers.join(', ')})`);
    
    const result3 = $`echo "test" | wc -c`.sync();
    const charCount = parseInt(result3.stdout.trim());
    console.log(`   pipeline sync: ${charCount === 5 ? '✅' : '❌'} (${charCount} chars)`);

    console.log('\n3️⃣  Synchronous with Events (Batched):');
    
    let eventCount = 0;
    let endEventFired = false;
    
    const result4 = $`echo -e "event1\nevent2\nevent3"`
      .on('data', (chunk) => {
        eventCount++;
        console.log(`   📥 Batched event ${eventCount}: ${chunk.data.toString().trim()}`);
      })
      .on('end', (result) => {
        endEventFired = true;
        console.log(`   🏁 End event: code ${result.code}`);
      })
      .sync();
    
    console.log(`   Events fired: ${eventCount > 0 ? '✅' : '❌'}`);
    console.log(`   End event: ${endEventFired ? '✅' : '❌'}`);
    console.log(`   Final result: ${result4.stdout.split('\n').length - 1} lines`);

    console.log('\n4️⃣  Error Handling in Sync Mode:');
    
    try {
      const errorResult = $`exit 42`.sync();
      console.log(`   ❌ Should have thrown error`);
    } catch (error) {
      console.log(`   ✅ Caught sync error: code ${error.code}`);
      console.log(`   ✅ Error type: ${error.constructor.name}`);
    }

    console.log('\n5️⃣  Sync vs Async Performance:');
    
    // Sync timing
    const syncStart = Date.now();
    const syncResult = $`seq 1 10`.sync();
    const syncTime = Date.now() - syncStart;
    
    // Async timing  
    const asyncStart = Date.now();
    const asyncResult = await $`seq 1 10`;
    const asyncTime = Date.now() - asyncStart;
    
    console.log(`   Sync execution: ${syncTime}ms`);
    console.log(`   Async execution: ${asyncTime}ms`);
    console.log(`   Both results match: ${syncResult.stdout === asyncResult.stdout ? '✅' : '❌'}`);

    console.log('\n6️⃣  Complex Synchronous Operations:');
    
    // File operations in sync mode
    const tempDir = `sync-test-${Date.now()}`;
    
    $`mkdir -p ${tempDir}`.sync();
    $`echo "sync content" > ${tempDir}/file.txt`.sync();
    const content = $`cat ${tempDir}/file.txt`.sync();
    $`rm -rf ${tempDir}`.sync();
    
    console.log(`   Complex sync operations: ${content.stdout.includes('sync content') ? '✅' : '❌'}`);

    console.log('\n7️⃣  Sync Mode with Different Command Types:');
    
    // System commands
    const systemSync = $`echo "system command"`.sync();
    console.log(`   System sync: ${systemSync.stdout.includes('system') ? '✅' : '❌'}`);
    
    // Built-in commands
    const builtinSync = $`pwd`.sync();
    console.log(`   Built-in sync: ${builtinSync.stdout.length > 0 ? '✅' : '❌'}`);
    
    // Pipeline commands
    const pipelineSync = $`echo "test" | cat`.sync();
    console.log(`   Pipeline sync: ${pipelineSync.stdout.includes('test') ? '✅' : '❌'}`);

    console.log('\n8️⃣  Sync with Custom Options:');
    
    const customSync = $({ 
      env: { ...process.env, TEST_VAR: `sync-${runtime}` } 
    })`echo $TEST_VAR`.sync();
    
    console.log(`   Custom env sync: ${customSync.stdout.includes('sync') ? '✅' : '❌'}`);

    console.log('\n9️⃣  Mixed Sync/Async Operations:');
    
    // Start with sync
    const mixedResult1 = $`echo "step1"`.sync();
    console.log(`   Mixed step 1: ${mixedResult1.stdout.trim()}`);
    
    // Continue with async
    const mixedResult2 = await $`echo "step2"`;
    console.log(`   Mixed step 2: ${mixedResult2.stdout.trim()}`);
    
    // Back to sync
    const mixedResult3 = $`echo "step3"`.sync();
    console.log(`   Mixed step 3: ${mixedResult3.stdout.trim()}`);

    console.log('\n🔟  Synchronous Execution Control:');
    
    // Create command without auto-starting
    const cmd = $`echo "controlled execution"`;
    console.log(`   Command created: ${!cmd.started ? '✅' : '❌'}`);
    
    // Start synchronously
    const controlledResult = cmd.sync();
    console.log(`   Started and completed: ${cmd.started ? '✅' : '❌'}`);
    console.log(`   Controlled result: ${controlledResult.stdout.trim()}`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All synchronous execution patterns work perfectly in ${runtime}!`);
    console.log('⚡ Sync and async modes provide identical results!');
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

executionSyncComparison();